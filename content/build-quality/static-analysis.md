# 7.7 clang-tidy와 정적 분석

::: lead
[7.5](#/sanitizers)에서 ASan·UBSan·TSan이 "계측된 코드를 실행해서" 버그를 잡는다는 걸 봤다 — 그림자 메모리를 조회하는 코드도, 벡터 시계를 갱신하는 코드도 전부 **프로그램이 실제로 그 줄을 지나갈 때만** 동작한다. 그래서 [7.5](#/sanitizers)의 `::: deep` 상자가 미리 못 박았다 — "실행되지 않은 코드 경로의 버그는 ASan도 못 잡는다." 테스트가 100번 통과해도 그 100번이 전부 같은 분기만 탔다면, 나머지 분기의 버그는 여전히 숨어 있다. 이 절은 그 구멍을 메우는 도구를 다룬다. clang-tidy는 프로그램을 한 번도 실행하지 않고 소스 코드 자체를 분석해서 — 컴파일러가 코드를 이해하는 방식 그대로, 하지만 실행 파일을 만들지 않고 — 이 구멍에 해당하는 버그를 잡는다. 실제로 "실행하면 조용하지만 정적 분석은 잡는" 버그 하나를 이 절 첫머리에서 직접 실측한다.
:::

## 동적 분석의 구멍을 실제로 연다

자기 대입(self-assignment)을 막지 않은 대입 연산자를 하나 만든다. 관절 캘리브레이션 오프셋 하나를 힙에 들고 있는 최소 클래스다.

```cpp title="calib_selfassign.cpp — 자기 대입을 막지 않은 operator="
#include <cstdio>

struct JointCalibration {
    double* offset;

    explicit JointCalibration(double v) : offset(new double(v)) {}
    ~JointCalibration() { delete offset; }

    JointCalibration& operator=(const JointCalibration& other) {
        delete offset;                        // other가 *this면 여기서 offset이 죽는다
        offset = new double(*other.offset);   // BUG: other.offset은 방금 delete한 그 주소
        return *this;
    }
};

int main() {
    JointCalibration a(1.5);
    JointCalibration b(2.5);
    a = b;                                     // 일반 대입 — 자기 대입이 아니다
    printf("a.offset=%f\n", *a.offset);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -g -fsanitize=address calib_selfassign.cpp -o calib_selfassign
$ ./calib_selfassign
a.offset=2.500000
$ echo $?
0
```

(g++ 13.3.0 / `-O0` / Ubuntu 24.04 x86-64 실측.) ASan을 붙여도 조용하다. 종료 코드도 0이다. `a = b`는 `a`와 `b`가 다른 객체라 `operator=` 안의 버그가 조건에 걸리지 않기 때문이다 — 이 프로그램을 천 번 실행해도, `a = b` 같은 호출만 하는 한 이 버그는 절대 드러나지 않는다. 이제 정확히 같은 `operator=`를 두고, 호출부만 `a = a`로 바꾼다.

```cpp title="calib_selfassign_triggered.cpp — 호출부만 자기 대입으로 바꿨다, operator= 자체는 동일"
int main() {
    JointCalibration a(1.5);
    a = a;                                     // 자기 대입 — 방금 그 버그를 정확히 밟는다
    printf("a.offset=%f\n", *a.offset);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -g -fsanitize=address calib_selfassign_triggered.cpp -o calib_selfassign_triggered
$ ./calib_selfassign_triggered
==15182==ERROR: AddressSanitizer: heap-use-after-free on address 0x502000000010 ...
READ of size 8 at 0x502000000010 thread T0
    #0 ... in JointCalibration::operator=(JointCalibration const&) calib_selfassign_triggered.cpp:11
...
freed by thread T0 here:
    #0 ... in operator delete(void*, unsigned long) ...
    #1 ... in JointCalibration::operator=(JointCalibration const&) calib_selfassign_triggered.cpp:10
...
SUMMARY: AddressSanitizer: heap-use-after-free calib_selfassign_triggered.cpp:11 in JointCalibration::operator=(JointCalibration const&)
$ echo $?
1
```

(g++ 13.3.0 실측. 스택 트레이스는 지면상 줄였다.) 정확히 같은 함수 안의 정확히 같은 버그인데, 이번엔 `heap-use-after-free`가 터진다. `delete offset`이 `offset`을 해제하는 순간 `other.offset`도 같이 죽는다 — `other`가 `*this`와 같은 객체이기 때문이다. 그다음 줄 `new double(*other.offset)`이 해제된 주소를 읽는다. **버그는 처음부터 그 자리에 있었다.** 어느 호출이 이 버그를 드러내는지는 순전히 "그 실행이 자기 대입을 우연히 밟았는가"에 달려 있다. 이제 이 `operator=`를 프로그램을 한 번도 실행하지 않고 잡아 본다.

```console
$ clang-tidy -checks='-*,bugprone-unhandled-self-assignment' calib_selfassign.cpp -- -std=c++20
1 warning generated.
calib_selfassign.cpp:9:23: warning: operator=() does not handle self-assignment properly [bugprone-unhandled-self-assignment]
    9 |     JointCalibration& operator=(const JointCalibration& other) {
      |                       ^
```

(clang-tidy 18.1.3, Ubuntu 24.04 x86-64 실측.) `main`이 `a = b`만 호출하는 **원래 파일**(`calib_selfassign.cpp`, 자기 대입 호출이 아예 없는 그 파일)에 그대로 돌렸다. 프로그램을 실행하지 않았다 — 애초에 실행 파일을 만들지도 않았다. 그런데도 `operator=` 함수 정의 자체가 `this == &other`를 확인하지 않는다는 걸 근거로 경고를 낸다. **호출이 이 버그를 밟느냐 마느냐와 무관하게** 경고가 뜬다는 게 핵심이다.

## clang-tidy는 실행하지 않는다 — 소스를 컴파일러의 눈으로 읽을 뿐이다

clang-tidy가 실행 파일을 만들지 않고도 위와 같은 진단을 낼 수 있는 이유는 컴파일 과정의 앞부분만 쓰기 때문이다. g++·clang 모두 컴파일은 대략 ① 전처리 ② 어휘·구문 분석으로 추상 구문 트리(AST, Abstract Syntax Tree) 생성 ③ 의미 분석(타입 검사, 오버로드 해석) ④ 코드 생성(어셈블리로 변환) ⑤ 링크의 단계를 거친다. clang-tidy는 clang 프론트엔드를 그대로 써서 ①~③까지 진행해 완전한 AST를 만들고, **거기서 멈춘다.** 코드 생성도, 링크도, 실행도 하지 않는다.

```text nolines
[전처리] -> [AST 생성] -> [의미 분석]  <- clang-tidy는 여기까지만 쓴다
                                    |
                                    v (여기서부터는 안 감)
                             [코드 생성] -> [링크] -> [실행]  <- ASan/UBSan/TSan은 결국 여기 계측을 심는다
```

완성된 AST 위에서 clang-tidy의 각 검사(check)는 **AST 매처(AST matcher)** — "이런 모양의 구문 트리 패턴이 있는가"를 찾는 질의 — 를 돌린다. `bugprone-unhandled-self-assignment`의 매처는 대략 "클래스의 복사 대입 연산자 본문 안에서 `this`와 매개변수의 주소를 비교하는 조건문이 없는가"를 찾는다. 이 조건은 함수의 **텍스트 구조**만으로 판단할 수 있다 — 그 함수가 실제로 몇 번 호출되는지, 어떤 인자로 호출되는지는 전혀 필요 없다. 그래서 `main`이 `a = b`만 부르든 `a = a`를 한 번이라도 부르든 상관없이 똑같은 경고가 나온다.

::: deep AST 매처는 컴파일러가 이미 다 아는 정보를 다시 쓴다
clang-tidy가 새로 뭔가를 추론하는 게 아니다 — 오버로드 해석, 타입 검사, 템플릿 인스턴스화까지 전부 clang 프론트엔드가 정확히 컴파일러 자신을 위해 계산해 둔 정보다. clang-tidy는 그 결과물(AST)을 컴파일러 대신 읽고, "이 패턴은 버그로 이어지기 쉽다"거나 "이 패턴은 더 새로운 문법으로 바꿀 수 있다"는 규칙을 사람이 미리 매처로 등록해 둔 것뿐이다. 그래서 clang-tidy의 진단 품질은 곧 clang 프론트엔드의 타입 분석 품질과 같다 — 템플릿이 복잡해서 컴파일러가 타입을 정확히 추론하면 clang-tidy도 정확히 그 타입 기준으로 검사한다.
:::

## modernize 계열 — 오래된 문법을 새 표준으로

`modernize-*` 검사들은 컴파일은 되지만 더 나은 C++11 이후 문법이 있는 자리를 잡는다. 오래된 스타일 셋을 한 파일에 모아서 실측한다.

```cpp title="legacy_style.cpp — typedef, 손 반복자, NULL"
#include <cstdio>
#include <vector>

typedef std::vector<int> IntList;

void printAll(const IntList& list) {
    for (std::vector<int>::const_iterator it = list.begin(); it != list.end(); ++it) {
        printf("%d\n", *it);
    }
}

int* makeNull() {
    return NULL;
}

int main() {
    IntList v{1, 2, 3};
    printAll(v);
    int* p = makeNull();
    printf("%p\n", (void*)p);
    return 0;
}
```

```console
$ clang-tidy -checks='-*,modernize-use-using,modernize-use-nullptr,modernize-loop-convert' legacy_style.cpp -- -std=c++20
legacy_style.cpp:4:1: warning: use 'using' instead of 'typedef' [modernize-use-using]
    4 | typedef std::vector<int> IntList;
      | ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      | using IntList = std::vector<int>
legacy_style.cpp:7:5: warning: use range-based for loop instead [modernize-loop-convert]
    7 |     for (std::vector<int>::const_iterator it = list.begin(); it != list.end(); ++it) {
      |     ^   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      |         (int it : list)
legacy_style.cpp:13:12: warning: use nullptr [modernize-use-nullptr]
   13 |     return NULL;
      |            ^~~~
      |            nullptr
```

(clang-tidy 18.1.3 실측 — 지면상 fix-it 힌트 줄만 남겼다.) 세 경고 다 아래에 실제 수정 제안을 같이 낸다는 게 중요하다 — `using IntList = std::vector<int>`, `(int it : list)`, `nullptr`. `clang-tidy --fix`를 붙이면 이 제안을 파일에 직접 적용해 준다(이 책은 표시·복사 전용이 원칙이라 `--fix`는 네 IDE 터미널에서 직접 시도해 보라). 이 파일 하나만 대상으로 지정했는데도 검사를 필터 없이 돌리면 `<vector>` 내부에서 나는 시스템 헤더 경고까지 수백 개가 같이 뜬다.

::: note 기본적으로 네가 지정한 파일의 경고만 보여준다
`-checks` 없이 그냥 `clang-tidy legacy_style.cpp`를 돌리면 "351 warnings generated"처럼 뜨고 바로 밑에 "Suppressed 348 warnings (348 in non-user code)"가 따라온다 — clang-tidy가 `<vector>`, `<cstdio>` 내부까지 AST를 다 만들기 때문에 헤더 내부에서도 검사가 돌지만, 기본 설정은 **네가 명령줄에 직접 준 파일 안의 경고만** 보여준다. 프로젝트 헤더까지 같이 보고 싶으면 `--header-filter=<정규식>`으로 범위를 넓힌다.
:::

## bugprone 계열 — 컴파일은 되지만 진짜 버그가 되는 패턴

앞서 본 `bugprone-unhandled-self-assignment`가 이 계열의 대표다. `bugprone-*`는 이름 그대로 "버그가 되기 쉬운(bug-prone)" 패턴을 잡는다 — 문법적으로는 완전히 유효한 코드가 대상이다. 정수 나눗셈 실수도 같은 계열이다.

```cpp title="leg_odometry.cpp — 정수 나눗셈이 부동소수점 문맥에 들어간다"
double averageLegSpeed(int totalTicks, int legCount) {
    return totalTicks / legCount;   // 나눗셈이 int로 끝난 뒤 double로 변환된다
}
```

```console
$ clang-tidy -checks='-*,bugprone-integer-division' leg_odometry.cpp -- -std=c++20
leg_odometry.cpp:5:12: warning: result of integer division used in a floating point context; possible loss of precision [bugprone-integer-division]
    5 |     return totalTicks / legCount;
      |            ^
```

(clang-tidy 18.1.3 실측.) `totalTicks / legCount`가 `int / int`라 정수 나눗셈으로 절단(truncation)이 먼저 일어나고, 그 정수 결과가 함수의 반환 타입 `double`로 변환된다. `averageLegSpeed(7, 2)`는 `3.5`가 아니라 `3.0`을 반환한다 — 헥사포드의 다리 인코더 틱을 평균 낼 때 이런 실수가 들어가면 소수부가 항상 조용히 잘려 나간다. 고치는 법은 피연산자 하나를 먼저 `double`로 캐스팅하는 것뿐이다: `static_cast<double>(totalTicks) / legCount`.

## performance 계열 — 불필요한 복사를 잡는다

`performance-*`는 버그는 아니지만 매 호출마다 값을 치르는 자리를 잡는다. 공분산 벡터를 담은 큰 구조체를 값으로 받는 함수를 실측한다.

```cpp title="leg_odometry.cpp (계속) — const&로 받아야 할 인자를 값으로 받는다"
#include <vector>

struct BigPose {
    double x, y, theta;
    std::vector<double> covariance;   // 36개짜리 공분산 행렬
};

double poseNorm(BigPose p) {          // p를 읽기만 하는데 매번 통째로 복사한다
    return p.x * p.x + p.y * p.y;
}
```

```console
$ clang-tidy -checks='-*,performance-unnecessary-value-param' leg_odometry.cpp -- -std=c++20
leg_odometry.cpp:13:25: warning: the parameter 'p' is copied for each invocation but only used as a const reference; consider making it a const reference [performance-unnecessary-value-param]
   13 | double poseNorm(BigPose p) {
      |                         ^
      |                 const  &
```

(clang-tidy 18.1.3 실측.) `poseNorm`은 `p`를 한 번도 수정하지 않는다 — 읽기만 한다. 그런데 값으로 받으면 호출할 때마다 `BigPose` 전체(공분산 벡터의 힙 버퍼 포함)가 복사된다. `const BigPose&`로 바꾸면 이 복사가 사라진다. `Pose norm(BigPose p)`를 초당 수백 번 부르는 상태 추정 루프([9.6](#/state-estimation) 칼만 필터 갱신 같은)라면 이 복사 하나하나가 누적된다 — 정확히 [7.5](#/sanitizers)나 이 절이 지금까지 그래 왔듯, 이 검사도 "몇 배 느리다"는 수치 없이 "복사가 일어난다"는 사실만 잡는다. 실제 배수는 [8.1](#/profiling)의 프로파일러로 측정할 몫이다.

## cppcoreguidelines 계열 — 초기화 누락을 잡는다

`cppcoreguidelines-*`는 C++ Core Guidelines(비야네 스트로스트룹·허브 서터가 이끄는 위원회 문서)의 규칙을 그대로 검사로 옮긴 것들이다. 멤버 초기화 누락이 대표적이다.

```cpp title="joint_state.cpp — 멤버를 초기화하지 않았다"
struct JointState {
    double angle;
    double velocity;
};

int main() {
    JointState j;              // angle, velocity 둘 다 쓰레기값
    printf("%f\n", j.angle);
    return 0;
}
```

```console
$ clang-tidy -checks='-*,cppcoreguidelines-pro-type-member-init' joint_state.cpp -- -std=c++20
joint_state.cpp:9:5: warning: uninitialized record type: 'j' [cppcoreguidelines-pro-type-member-init]
    9 |     JointState j;
      |     ^
      |                 {}
```

(clang-tidy 18.1.3 실측.) `JointState j;`는 컴파일이 통과하지만 `angle`과 `velocity`는 초기화되지 않은 스택 메모리 값을 그대로 들고 있다 — 이 값을 관절 각도로 그대로 쓰면 로봇이 예측 불가능한 자세로 움직인다. `-fsanitize=address`도 `-fsanitize=undefined`도 초기화되지 않은 값을 읽는 것 자체는 잡지 않는다(그 값이 유효한 스택 주소에 있고, 읽는 연산 자체는 UB가 아니기 때문이다 — 초기화되지 않은 값의 사용은 MemorySanitizer(MSan)의 영역이고, MSan은 ASan·TSan과 또 다르게 별도 빌드가 필요해 이 책에서는 다루지 않는다). fix-it이 제안하는 `{}`(값 초기화)를 붙이면 `angle`과 `velocity`가 `0.0`으로 확정된다.

## .clang-tidy — 검사 항목을 프로젝트마다 관리한다

지금까지 `-checks=` 명령줄 인자로 검사를 하나씩 골랐다. 실전에서는 저장소 루트에 `.clang-tidy` 파일 하나를 두고 관리한다 — clang-tidy는 대상 파일의 디렉터리부터 위로 올라가며 이 파일을 자동으로 찾는다.

```yaml title=".clang-tidy"
Checks: >
  -*,
  modernize-use-using,
  modernize-use-nullptr,
  modernize-loop-convert,
  bugprone-unhandled-self-assignment,
  bugprone-integer-division,
  performance-unnecessary-value-param,
  cppcoreguidelines-pro-type-member-init
```

`-*`가 전부 끈 뒤 뒤에 나열한 것만 다시 켠다는 뜻이다. 이 파일을 두고 `-checks` 없이 그냥 돌리면 명령줄로 골랐을 때와 똑같은 경고 세 개(`typedef`, 손 반복자, `NULL`)가 뜬다 — 파일이 실제로 적용됐다는 걸 직접 확인했다.

```console
$ clang-tidy legacy_style.cpp -- -std=c++20
...
legacy_style.cpp:4:1: warning: use 'using' instead of 'typedef' [modernize-use-using]
legacy_style.cpp:7:5: warning: use range-based for loop instead [modernize-loop-convert]
legacy_style.cpp:13:12: warning: use nullptr [modernize-use-nullptr]
```

이제 `modernize-use-nullptr` 앞에 `-`를 붙여 끈다.

```yaml title=".clang-tidy (수정)"
Checks: >
  -*,
  modernize-use-using,
  -modernize-use-nullptr,
  modernize-loop-convert,
  ...
```

```console
$ clang-tidy legacy_style.cpp -- -std=c++20
...
legacy_style.cpp:4:1: warning: use 'using' instead of 'typedef' [modernize-use-using]
legacy_style.cpp:7:5: warning: use range-based for loop instead [modernize-loop-convert]
```

(둘 다 clang-tidy 18.1.3, 같은 파일 실측.) `NULL` 줄에 대한 경고가 정확히 사라졌다 — 나머지 두 경고는 그대로다. **검사를 끄고 켜는 게 소스 코드를 한 글자도 안 건드리고 설정 파일 한 줄로 끝난다**는 게 요점이다. 새 팀원이 합류했을 때 "이 프로젝트가 어떤 규칙을 강제하는지"를 코드 리뷰 관습이 아니라 이 파일 하나로 답할 수 있다.

::: tip 카테고리 단위로 켜는 것도 된다
`Checks: -*, modernize-*` 처럼 와일드카드를 쓰면 `modernize` 카테고리 전체를 켠다. 처음 도입할 때는 `bugprone-*`, `performance-*`처럼 카테고리 단위로 켜고, 오탐이 자주 나는 개별 검사만 나중에 `-checks`에서 `-`로 하나씩 제외해 나가는 방식이 실무에서 더 흔하다 — 검사 이름을 전부 외워서 하나씩 나열할 필요는 없다.
:::

## CMake와 통합 — 빌드할 때마다 자동으로 돈다

`.clang-tidy`가 있어도 명령줄에서 매번 `clang-tidy`를 손으로 돌리면 결국 잊어버린다. `CMAKE_CXX_CLANG_TIDY` 변수를 설정해 두면 `make`/`ninja`가 각 소스 파일을 컴파일할 때마다 clang-tidy를 자동으로 같이 돌린다.

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.20)
project(clang_tidy_demo CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_CXX_CLANG_TIDY clang-tidy)   # 이 줄이 전부다

add_executable(leg_odometry leg_odometry.cpp)
```

```console
$ cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
$ cmake --build build
[ 50%] Building CXX object CMakeFiles/leg_odometry.dir/leg_odometry.cpp.o
leg_odometry.cpp:5:12: warning: result of integer division used in a floating point context; possible loss of precision [bugprone-integer-division]
    5 |     return totalTicks / legCount;
      |            ^
leg_odometry.cpp:13:25: warning: the parameter 'p' is copied for each invocation but only used as a const reference; consider making it a const reference [performance-unnecessary-value-param]
   13 | double poseNorm(BigPose p) {
      |                         ^
      |                 const  &
[100%] Linking CXX executable leg_odometry
[100%] Built target leg_odometry
```

(CMake로 실제 빌드해 실측 — 위 `.clang-tidy`를 그대로 옆에 둔 상태다.) `.o` 파일을 만드는 컴파일 명령 하나하나마다 clang-tidy가 같은 소스에 자동으로 끼어들어 경고를 찍은 뒤, 빌드 자체는 계속 진행돼 실행 파일이 정상적으로 만들어진다 — **경고가 나도 빌드가 실패하지 않는다는 게 기본값**이다. CI에서 "경고 하나라도 있으면 빌드 실패"로 강제하고 싶으면 `.clang-tidy`에 `WarningsAsErrors: '*'`를 추가하거나, `clang-tidy` 자체를 `--warnings-as-errors=*` 옵션으로 별도 잡에서 돌린다. [7.8 CI 파이프라인 구성](#/ci)에서 이 선택을 다룬다.

::: warn 매 파일 재컴파일 때마다 clang-tidy가 다시 돈다 — 빌드가 느려진다
`CMAKE_CXX_CLANG_TIDY`를 켜면 각 번역 단위를 컴파일할 때마다 AST를 다시 만들고 매처를 다시 돌린다. 파일 수가 많은 대형 워크스페이스(Nav2, `ros2_control` 규모)에서는 이 오버헤드가 체감된다. 그래서 실무에서는 평소 개발 빌드에는 끄고, CI 전용 빌드 타입이나 별도 CMake 프리셋에서만 `CMAKE_CXX_CLANG_TIDY`를 켜는 구성이 흔하다 — [7.8](#/ci)에서 이 분리를 실제로 만든다.
:::

## 오탐과 억제 — NOLINT

정적 분석은 실행 없이 패턴만 보고 판단하기 때문에 문맥을 완전히 이해하지 못할 때가 있다 — 실제로는 문제없는 코드를 오탐(false positive)으로 잡는 경우다. 레거시 C API와 맞물려서 의도적으로 `NULL`을 남겨야 하는 경계 코드를 예로 든다.

```cpp title="nolint_demo.cpp — 의도적으로 유지한 NULL, 주석으로 억제한다"
int* makeNull() {
    return NULL; // NOLINT(modernize-use-nullptr) -- 레거시 C API와의 호환 계층, 의도적으로 유지
}
```

```console
$ clang-tidy -checks='-*,modernize-use-nullptr' nolint_demo.cpp -- -std=c++20
Suppressed 1 warnings (1 NOLINT).
```

(clang-tidy 18.1.3 실측 — 같은 검사를 `NOLINT` 없는 `legacy_style.cpp`에 돌리면 경고가 뜨고, `NOLINT`를 붙인 이 파일에는 안 뜨는 것까지 직접 비교 확인했다.) `// NOLINT(<검사이름>)`을 그 줄 끝에 붙이면 해당 검사만 그 줄에서 억제된다. 검사 이름을 생략한 `// NOLINT`는 그 줄의 **모든** 검사를 억제한다.

::: danger NOLINT는 억제 사유를 남겨야 억제다
검사 이름 없이 `// NOLINT`만 붙이면 나중에 다른 검사를 새로 켰을 때 그 줄도 조용히 다 억제된 채로 남는다 — 오탐 하나를 막으려다 다른 진짜 버그까지 숨기는 셈이다. `// NOLINT(<검사이름>) -- <이유>`처럼 어떤 검사를, 왜 억제했는지 항상 같이 적어라. 이유 없는 `NOLINT`는 리뷰어 눈에는 "왜 껐는지 모르는 경고 무시"로 보인다 — 오탐이 아니라 진짜 버그를 덮은 것일 수도 있기 때문이다.
:::

::: interview "정적 분석과 동적 분석(새니타이저)의 차이를 설명하라"
답변 뼈대: ① 새니타이저(ASan/UBSan/TSan)는 프로그램을 컴파일해서 실제로 실행하고, 그 실행 중 계측된 코드가 지나가는 경로에서만 문제를 잡는 동적 분석이다 — 그래서 실행되지 않은 분기의 버그는 놓친다(이 절 도입부의 `calib_selfassign` 실측: `a = b`는 조용하고 `a = a`만 크래시). ② clang-tidy 같은 정적 분석은 컴파일러의 AST 생성·의미 분석 단계까지만 써서 실행 파일도 만들지 않고 소스의 구조 자체를 검사하므로, 호출 여부와 무관하게 코드 패턴만으로 진단한다. ③ 그래서 실무에서는 두 가지를 상호 보완적으로 CI에 같이 둔다 — 정적 분석은 커밋할 때마다 빠르게, 동적 분석은 테스트를 실제로 실행하는 잡에서.
:::

## 로보틱스 연결: colcon 워크스페이스에 정적 분석 끼우기

[7.5](#/sanitizers)에서 `colcon build --cmake-args -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined"`로 워크스페이스 전체에 새니타이저를 켰던 것과 똑같은 방식으로, `CMAKE_CXX_CLANG_TIDY`도 워크스페이스 인자로 넘길 수 있다.

```console
$ colcon build --cmake-args -DCMAKE_CXX_CLANG_TIDY=clang-tidy -DCMAKE_BUILD_TYPE=Debug
```

이렇게 하면 워크스페이스 안의 모든 `ament_cmake` 패키지가 각자의 `.clang-tidy`(패키지 루트에 있으면 그 설정을, 없으면 상위 디렉터리의 설정을 clang-tidy가 자동으로 찾아 적용) 기준으로 다시 빌드되면서 검사를 받는다. 헥사포드의 다리 컨트롤러 노드처럼 IK 계산([9.5](#/inverse-kinematics))과 인코더 콜백이 섞인 패키지에서는, 이 절의 `bugprone-unhandled-self-assignment`나 `cppcoreguidelines-pro-type-member-init` 같은 검사가 커밋 시점에 잡아내는 버그가 실제 로봇에서는 "어쩌다 한 번, 특정 조건에서만" 재현되는 종류의 버그다 — [7.5](#/sanitizers)의 새니타이저가 실행 경로에 의존하는 것과 정반대로, 이 검사들은 그 조건이 실제 로봇 위에서 한 번도 발생하지 않았어도 커밋 단계에서 미리 걸린다.

## 요약

- [7.5](#/sanitizers)의 새니타이저는 실행된 코드 경로에서만 계측이 동작하는 동적 분석이다 — 이 절 도입부에서 같은 `operator=` 버그를 `a = b`(조용함, 종료 코드 0)와 `a = a`(heap-use-after-free)로 직접 대조해 그 경계를 실측했다.
- clang-tidy는 clang 프론트엔드로 AST까지만 만들고 실행하지 않는다 — AST 매처로 소스의 구조적 패턴을 찾기 때문에 호출 여부와 무관하게 같은 진단이 나온다.
- `modernize-*`(typedef→using, 손 반복자→range-for, NULL→nullptr), `bugprone-*`(자기 대입 미처리, 정수 나눗셈), `performance-*`(불필요한 값 복사), `cppcoreguidelines-*`(멤버 초기화 누락) 네 계열 모두 실제 경고 메시지와 fix-it을 실측했다.
- `.clang-tidy` 파일의 `Checks:` 목록에 `-`를 붙이고 떼는 것만으로 특정 검사의 경고가 실제로 나타났다 사라지는 것까지 확인했다 — 소스를 건드릴 필요가 없다.
- `CMAKE_CXX_CLANG_TIDY` 변수 한 줄로 `cmake --build`가 각 소스 파일을 컴파일할 때마다 clang-tidy를 자동으로 돌리는 것을 실제 빌드 로그로 확인했다. 경고가 나도 빌드 자체는 실패하지 않는다.
- 오탐은 `// NOLINT(<검사이름>) -- <이유>`로 억제한다 — 이유 없는 `NOLINT`는 나중에 진짜 버그까지 같이 숨긴다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습(4번은 코드 작성형)이다.

1. 이 절의 `calib_selfassign.cpp`/`calib_selfassign_triggered.cpp` 실측을 근거로, "새니타이저는 실행된 경로만 잡는다"는 문장이 구체적으로 무엇을 뜻하는지 한 문단으로 써라.

2. clang-tidy가 코드를 실행하지 않고도 `bugprone-unhandled-self-assignment` 같은 진단을 낼 수 있는 이유를 컴파일 단계(전처리·AST 생성·의미 분석·코드 생성·링크) 중 어디까지를 쓰는지와 함께 설명하라.

3. (예측) `.clang-tidy`에 `Checks: -*, cppcoreguidelines-*`만 넣고 이 절의 네 예제 파일(`legacy_style.cpp`, `calib_selfassign.cpp`, `leg_odometry.cpp`, `joint_state.cpp`)에 전부 돌리면, `joint_state.cpp`를 제외한 나머지 세 파일에서도 경고가 뜰지 예측하고 근거를 써라. 힌트: 이 절에서 각 파일에 실제로 트리거한 검사가 어느 카테고리(`modernize-`/`bugprone-`/`performance-`/`cppcoreguidelines-`)에 속하는지 다시 짚어라.

4. (실습, 코드 작성형) `bugprone-integer-division`이 잡은 `averageLegSpeed`를 `static_cast<double>(totalTicks) / legCount`로 직접 고쳐 타이핑하고, `clang-tidy -checks='-*,bugprone-integer-division' <파일> -- -std=c++20`을 다시 돌려 경고가 사라지는 것을 확인하라. 그다음 `g++ -std=c++20 -Wall -Wextra averageLegSpeed(7, 2)`를 실제로 호출하는 `main`을 붙여 컴파일·실행해서 출력이 `3.0`에서 `3.5`로 바뀌는지 확인하는 것이 성공 기준이다.

5. (실습) 이 절의 `nolint_demo.cpp`를 그대로 타이핑하고 `NOLINT` 주석을 지운 버전과 남긴 버전 두 개를 각각 `clang-tidy -checks='-*,modernize-use-nullptr' <파일> -- -std=c++20`으로 돌려, "Suppressed 1 warnings (1 NOLINT)" 문구가 있는 쪽과 실제 경고가 뜨는 쪽을 네 화면에서 직접 대조하라.
:::

::: answer 해설
1. `a = b`(서로 다른 객체)를 실행할 때는 `operator=` 안의 자기 대입 미처리 버그가 있는 코드 줄을 지나가긴 하지만, 그 버그가 실제로 문제를 일으키는 조건(`other`가 `*this`와 같은 경우)은 지나가지 않는다. ASan은 실제로 실행된 메모리 접근만 계측하므로, 이 조건 자체가 한 번도 발생하지 않으면 프로그램이 아무리 많이 실행되고 종료 코드가 계속 0이어도 버그가 있다는 사실 자체를 알 수 없다 — 실측에서 `a = a`로 조건을 실제로 발생시켰을 때만 `heap-use-after-free`가 나온 것이 그 증거다.
2. clang-tidy는 전처리와 AST 생성, 그리고 타입 검사·오버로드 해석을 포함하는 의미 분석까지만 clang 프론트엔드를 그대로 써서 진행하고, 그 뒤 코드 생성·링크·실행 단계로는 전혀 넘어가지 않는다. `bugprone-unhandled-self-assignment`의 AST 매처는 "복사 대입 연산자 본문에 `this`와 매개변수 주소를 비교하는 조건문이 있는가"라는 구조적 질문만 던지는데, 이 질문은 함수가 실제로 몇 번 어떻게 호출되는지와 무관하게 그 함수의 AST 하나만 봐도 답할 수 있다.
3. `joint_state.cpp`(cppcoreguidelines-pro-type-member-init)를 빼면 나머지 세 파일에서는 경고가 뜨지 않는다. `legacy_style.cpp`의 typedef/손 반복자/NULL은 `modernize-*` 카테고리, `calib_selfassign.cpp`의 자기 대입과 `leg_odometry.cpp`의 정수 나눗셈은 `bugprone-*` 카테고리, `leg_odometry.cpp`의 `BigPose` 값 전달은 `performance-*` 카테고리에 속한다 — `cppcoreguidelines-*`만 켰으니 이 셋은 전부 검사 대상에서 빠진다.
4. 수정 후 `clang-tidy` 재실행 결과에는 `bugprone-integer-division` 경고 줄이 더 이상 나오지 않아야 한다. `static_cast<double>`을 앞쪽 피연산자에 붙이면 나눗셈 자체가 `double / int`로 승격되어 절단이 일어나지 않으므로, `averageLegSpeed(7, 2)`의 실제 출력이 `3.000000`에서 `3.500000`으로 바뀌는 것까지 확인해야 성공이다.
5. `NOLINT` 없는 버전은 이 절 §modernize에서 본 것과 똑같이 `warning: use nullptr [modernize-use-nullptr]`가 그대로 떠야 한다. `NOLINT(modernize-use-nullptr)`를 붙인 버전은 경고 대신 `Suppressed 1 warnings (1 NOLINT).`만 출력돼야 한다 — 같은 코드, 같은 검사인데 억제 주석 한 줄 차이로 출력이 갈리는 것을 직접 봐야 한다.
:::

이 절의 `calib_selfassign.cpp`, `calib_selfassign_triggered.cpp`, `legacy_style.cpp`, `leg_odometry.cpp`, `joint_state.cpp`, `nolint_demo.cpp`, `.clang-tidy`, `CMakeLists.txt`는 전부 직접 타이핑해라. 특히 `.clang-tidy`에서 `modernize-use-nullptr` 앞에 `-`를 붙였다 뗐다 하면서 `clang-tidy legacy_style.cpp -- -std=c++20`을 반복 실행해 경고가 사라지고 나타나는 걸 눈으로 확인하는 게 이 절에서 가장 중요한 실습이다. 기준 명령: `clang-tidy -checks='-*,<검사이름>' <파일> -- -std=c++20`(개별 검사 지정), `clang-tidy <파일> -- -std=c++20`(`.clang-tidy` 자동 적용), `cmake --build build`(`CMAKE_CXX_CLANG_TIDY` 설정 시 자동 실행).

**다음 절**: [7.8 CI 파이프라인 구성](#/ci) — 이 절의 clang-tidy와 [7.5](#/sanitizers)의 새니타이저를 GitHub Actions 위에서 커밋마다 자동으로 돌리는 파이프라인을 실제로 만든다.
