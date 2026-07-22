# 1.8 구조체와 열거형

::: lead
[1.7](#/arrays-strings)까지 다룬 데이터는 전부 값 하나짜리였다. 이 절은 값 여러 개를 **하나의 의미**로 묶는 도구다. 관절 하나의 위치·속도·토크를 낱개 변수와 병렬 배열로 끌고 다니는 코드가 어떻게 무너지는지부터 보고, 구조체의 초기화 규칙, `sizeof`가 멤버 합보다 커지는 현상, "구조체는 값이다"라는 C++의 기본 태도를 전부 실측으로 확인한다. 후반부는 열거형이다 — 구식 `enum`이 스코프를 오염시키고 아무 정수와 조용히 섞이는 것을 눈으로 본 뒤, `enum class`로 로봇 상태 머신을 타입에 새긴다. [1.5](#/control-flow)에서 미리 썼던 `GaitState`의 전모가 여기서 나온다.
:::

## 흩어진 값은 사고가 된다

정의부터 시작하지 않는다. 구조체 없이 로봇 코드를 쓰면 무슨 일이 나는지부터 본다. 헥사포드는 다리 6개, 다리당 관절 3개 — 관절 18개다. 관절 하나의 상태는 위치·속도·토크 세 값이고, 이것을 낱개 변수로 들고 다니면 이렇게 된다.

```cpp title="조각: 다리 하나에 변수 9개, 로봇 전체면 54개"
// ❌ 다리 하나(coxa-femur-tibia)만 이렇다. 다리가 6개다
double coxa_pos,  coxa_vel,  coxa_eff;
double femur_pos, femur_vel, femur_eff;
double tibia_pos, tibia_vel, tibia_eff;
```

배열로 바꾸면 나아 보인다. 관절 인덱스 하나로 18개를 순회할 수 있으니까. 그런데 이번엔 **같은 관절의 세 값이 세 배열에 흩어진다** — 병렬 배열(parallel array) 구조다.

```cpp title="조각: 병렬 배열 — 컴파일러가 지켜 주지 못하는 코드"
double positions[18];
double velocities[18];
double efforts[18];

void log_joint(double pos, double vel, double eff);

// ❌ 인자 순서를 바꿔 넘겼다. 셋 다 double이라 컴파일러는 침묵한다
log_joint(velocities[3], positions[3], efforts[3]);
```

이 호출은 경고 없이 컴파일된다. 파라미터도 인자도 전부 `double`이니 타입 시스템이 개입할 근거가 없다. 로그에는 속도가 위치 자리에 찍히고, 이 로그를 믿고 게인을 튜닝하면 사고는 코드 밖으로 번진다. 문제의 뿌리는 하나다 — **"관절 하나의 상태"라는 의미 단위가 코드 어디에도 없다.** 구조체는 그 묶음을 타입으로 만든다.

```cpp title="joint.cpp — 의미의 단위를 타입으로"
struct JointState {
    double position;
    double velocity;
    double effort;
};

JointState joints[18];                    // 관절 18개, 값 셋이 항상 붙어 다닌다

void log_joint(const JointState& js);     // 순서를 바꿔 넘길 방법 자체가 없다
```

이 `JointState`는 [0.2](#/toolchain-setup)에서 툴체인 검증용으로 이미 타이핑해 본 그 구조체다. 거기서 예고한 대로, 이 세 필드 묶음은 ROS 2의 관절 상태 메시지, ros2_control이 하드웨어와 주고받는 인터페이스의 최소 단위와 같은 모양이다. 구조체는 문법 항목이 아니라 **도메인의 어휘를 코드에 새기는 도구**다.

::: note ROS 2 메시지의 정체는 구조체 코드젠이다
ROS 2에서 토픽으로 나르는 메시지는 `.msg` 파일(IDL)로 정의하고, 빌드가 그 정의에서 C++ 구조체를 **생성**한다. `sensor_msgs/msg/JointState`를 include하면 나오는 것은 멤버가 나열된 구조체다 — 코드 생성기가 찍어낸, 이 절에서 배우는 바로 그 물건이다. 메시지를 설계한다는 것은 곧 구조체를 설계한다는 뜻이고, 이 절의 규칙(멤버 순서, 기본값, 값 복사)이 그대로 적용된다. 생성된 코드가 실제로 어떻게 흐르는지는 [10.2](#/pub-sub)에서 본다.
:::

## 집성체: 중괄호가 곧 초기화다

위의 `JointState`처럼 **사용자가 선언한 생성자가 없고, 모든 비정적 멤버가 public이고, 가상함수가 없는** 타입을 집성체(aggregate)라 부른다. "그냥 데이터 묶음"이라는 뜻이고, 집성체는 특권을 하나 받는다 — 중괄호로 멤버를 **선언 순서대로** 직접 채울 수 있다.

```cpp title="agg.cpp — 부분 초기화: 나머지는 0이 된다"
#include <cstdio>

struct JointState {
    double position;
    double velocity;
    double effort;
};

int main() {
    JointState a{1.57};              // 부분 초기화: 나머지는 0
    JointState b;                    // 초기화 없음: 멤버는 미정 상태
    std::printf("a = {%g, %g, %g}\n", a.position, a.velocity, a.effort);
    std::printf("b = {%g, %g, %g}\n", b.position, b.velocity, b.effort);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra agg.cpp -o agg
agg.cpp:10:22: warning: missing initializer for member 'JointState::velocity' [-Wmissing-field-initializers]
agg.cpp:13:16: warning: 'b.JointState::effort' is used uninitialized [-Wuninitialized]
$ ./agg
a = {1.57, 0, 0}
b = {0, 6.93096e-310, 6.95261e-310}
$ ./agg
a = {1.57, 0, 0}
b = {0, 6.91657e-310, 6.95324e-310}
```

두 변수의 운명이 갈렸다. `a`는 중괄호를 열었으므로 명시하지 않은 멤버가 전부 **값 초기화(0)** 된다 — 표준이 보장하는 동작이다. 반면 중괄호가 없는 `b`는 [1.3](#/variables)의 미초기화 지역 변수 규칙을 그대로 따른다 — 멤버는 미정 상태이고, 읽는 순간 UB다. 실행할 때마다 다른 쓰레기값이 나온 것이 그 증거다(`b.position`의 0도 우연일 뿐 보장이 아니다). `{1.57}`에 붙은 `-Wmissing-field-initializers` 경고는 "일부만 채운 것이 의도냐"는 확인 질문이다 — 아래 멤버 기본값을 쓰면 사라진다.

::: danger 구조체 선언에 중괄호 하나 안 붙이는 습관이 UB를 만든다
`JointState b;`와 `JointState b{};`는 한 글자 차이로 UB와 전부-0이 갈린다. 센서 필터의 상태 구조체를 중괄호 없이 선언하면 첫 제어 주기는 쓰레기값으로 계산된다 — 이 환경에서는 `6.9e-310` 같은 티 나는 값이었지만, 진짜 각도처럼 보이는 값이 나오는 날도 있고 그날은 디버깅이 지옥이 된다. 규칙은 [1.3](#/variables)과 동일하다: **구조체 변수도 선언하는 그 줄에서 초기화한다.** 최소한 `{}`라도 붙여라.
:::

### designated initializer: 이름으로 채운다

[0.2](#/toolchain-setup)에서 C++20 확인용으로 쳐 봤던 문법이 바로 집성체 초기화의 확장판이다. 멤버가 셋을 넘어가면 `{1.57, 0.3, 0.0}`이 각각 무엇인지 호출부에서 읽히지 않는다 — 이름을 붙이면 읽힌다.

```cpp title="조각: 위치 기반 vs 이름 기반"
JointState js1{ 1.57, 0.0, 3.2 };                                  // 무엇이 무엇인지 호출부만 봐서는 모른다
JointState js2{ .position = 1.57, .velocity = 0.0, .effort = 3.2 };  // 읽힌다
```

단, C++의 designated initializer에는 C에는 없는 제약이 있다. **선언 순서를 지켜야 한다.** 실측:

```cpp title="desig.cpp — 순서를 어기면"
JointState js{ .velocity = 0.5, .position = 1.57 };   // 선언 순서 위반
```

```console
$ g++ -std=c++20 -Wall -Wextra -c desig.cpp
desig.cpp:8:54: error: designator order for field 'JointState::position' does not match declaration order in 'JointState'
```

::: deep 왜 순서를 강제하나
C99의 designated initializer는 순서 자유에 중복·건너뛰기까지 허용한다. C++이 순서를 강제한 이유는 초기화가 곧 **생성**이기 때문이다 — C++ 멤버는 선언 순서대로 생성되고 역순으로 소멸된다는 언어 차원의 보장이 있고([3.2](#/constructors)에서 전모를 다룬다), 초기화 순서가 표기 순서와 다르면 그 보장과 표기가 어긋난 코드를 읽게 된다. 표기와 실제가 다른 문법을 위원회는 받지 않았다.
:::

### 멤버 기본값: 구조체 설계자가 0을 보장한다

미정 상태 문제를 사용처의 습관(`{}` 붙이기)에 맡기지 않고 **타입 정의에서 원천 봉쇄**하는 방법이 있다. 멤버 선언에 기본값을 붙이는 것 — 기본 멤버 초기화자(default member initializer)다.

```cpp title="defmem.cpp — 이제 어떻게 선언해도 미정 상태가 없다"
#include <cstdio>

struct JointState {
    double position = 0.0;
    double velocity = 0.0;
    double effort   = 0.0;
    bool   calibrated = false;
};

int main() {
    JointState b;                    // 이제 미정 상태가 아니다
    std::printf("b = {%g, %g, %g, %d}\n", b.position, b.velocity, b.effort, b.calibrated);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra defmem.cpp -o defmem
$ ./defmem
b = {0, 0, 0, 0}
```

중괄호 없는 `JointState b;`인데 전부 0이다. 중괄호 초기화에서 명시하지 않은 멤버도 이제 0이 아니라 **그 기본값**으로 채워지고, 실측해 보면 `-Wmissing-field-initializers` 경고도 사라진다 — 기본값이 있으니 "빠뜨린 것"이 아니게 됐기 때문이다.

::: tip 상태를 담는 구조체에는 기본값을 박아라
관례는 단순하다. **"이 값이 미정이면 위험한가"에 예라고 답하는 멤버는 전부 기본 멤버 초기화자를 가진다.** 로봇의 상태·명령·설정 구조체는 거의 전부 해당한다. 기본값이 있어도 집성체 자격은 유지된다(C++14부터). 생성자와의 역할 분담은 [3.1](#/classes)에서 정리한다.
:::

## sizeof는 멤버 합이 아니다 — 패딩 미리보기

구조체의 크기를 물으면 놀라운 답이 나온다. `char`(1) + `double`(8) + `int`(4) = 13바이트여야 할 것 같은데, 실측은 다르다. 심지어 **멤버 순서만 바꿔도 크기가 달라진다.**

```cpp title="pad.cpp — 같은 멤버, 다른 크기"
#include <cstdio>

struct Bad {                 // 크기를 생각 안 한 배치
    char   id;
    double position;
    int    error_code;
};

struct Good {                // 큰 것부터
    double position;
    int    error_code;
    char   id;
};

int main() {
    std::printf("char + double + int = %zu\n", sizeof(char) + sizeof(double) + sizeof(int));
    std::printf("sizeof(Bad)         = %zu\n", sizeof(Bad));
    std::printf("sizeof(Good)        = %zu\n", sizeof(Good));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra pad.cpp -o pad
$ ./pad
char + double + int = 13
sizeof(Bad)         = 24
sizeof(Good)        = 16
```

멤버 합 13이 배치에 따라 24도 되고 16도 된다. 컴파일러가 멤버 사이와 끝에 이름 없는 빈 공간 — 패딩(padding) — 을 끼워 넣었기 때문이다. 어디에 끼었는지 바이트 단위로 그리면 이렇다(x86-64 Linux 실측 배치).

```text nolines
struct Bad -- 24 bytes
+----+---------------+----------------+-----------+--------+
| c  |    pad(7)     |   double(8)    |  int(4)   | pad(4) |
+----+---------------+----------------+-----------+--------+
0    1               8                16          20       24

struct Good -- 16 bytes
+----------------+-----------+----+--------+
|   double(8)    |  int(4)   | c  | pad(3) |
+----------------+-----------+----+--------+
0                8           12   13       16
```

왜 컴파일러가 이런 짓을 하는가 — 각 타입이 요구하는 메모리 주소의 "정렬" 때문인데, 그 전모(정렬 규칙, `alignas`, 캐시 라인)는 [2.12 객체 메모리 레이아웃과 정렬](#/object-layout)의 주제다. 여기서는 현상과 수칙만 가져간다. 첫째, **`sizeof(구조체)`는 멤버 합보다 크거나 같고, 정확한 값은 재 봐야 안다.** 통신 패킷처럼 바이트 배치가 계약인 자리에서 멤버 합으로 어림잡으면 틀린다. 둘째, **멤버를 큰 것부터 배치하면 패딩이 줄어드는 경향이 있다.** `Bad` 배치로 관절 18개 배열을 만들면 432바이트, `Good` 배치면 288바이트 — 같은 정보에 1.5배 차이다. 이 차이가 캐시와 만나 실행 시간이 되는 이야기는 [8.2](#/cache)에서 측정한다.

## 구조체는 값이다

C++에서 구조체는 `int`와 똑같이 행동한다. 대입하면 **전체가 복사**되고, 복사본은 원본과 완전히 독립이다. 실측:

```cpp title="copy.cpp — 대입은 복사다"
#include <cstdio>

struct JointState {
    double position = 0.0;
    double velocity = 0.0;
    double effort   = 0.0;
};

int main() {
    JointState a{ .position = 1.57, .velocity = 0.3 };
    JointState b = a;                // 복사
    b.position = 9.99;               // 복사본만 수정

    std::printf("a.position = %g\n", a.position);
    std::printf("b.position = %g\n", b.position);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra copy.cpp -o copy
$ ./copy
a.position = 1.57
b.position = 9.99
```

`b`를 고쳤는데 `a`는 1.57 그대로다. 참조나 핸들을 기본으로 하는 언어들과 정반대의 태도이고, C++의 값 시맨틱은 여기서 출발한다. 따라오는 결론이 둘 있다.

첫째, **함수 전달에는 [1.6](#/functions)의 규칙이 그대로 적용된다.** 구조체를 값으로 넘기면 저 복사가 호출마다 일어난다. 읽기만 하면 `const&`, 수정하면 `&`, 결과는 반환값 — 위 `log_joint(const JointState&)` 시그니처가 그 적용이다. 복사 비용은 1.6에서 이미 실측했으므로 반복하지 않는다.

둘째, 복사는 공짜로 주면서 **비교는 공짜로 주지 않는다.** 실측:

```cpp title="조각: == 는 기본 제공이 아니다"
JointState a{1.57, 0.3, 0.0};
JointState b{1.57, 0.3, 0.0};
return a == b;                   // 기본 제공될까?
```

```console
$ g++ -std=c++20 -Wall -Wextra -c eq.cpp
eq.cpp:10:14: error: no match for 'operator==' (operand types are 'JointState' and 'JointState')
```

대입은 되는데 비교는 에러다. C++20 전에는 `operator==`를 손으로 써야 했고, 멤버를 추가하고 비교 함수를 안 고치는 고전적 버그의 산지였다. C++20은 한 줄로 해결한다 — 컴파일러에게 "멤버 순서대로 전부 비교하는 ==를 만들어 달라"고 위임하는 `= default`다.

```cpp title="eq2.cpp — C++20 defaulted comparison"
#include <cstdio>

struct JointState {
    double position = 0.0;
    double velocity = 0.0;
    double effort   = 0.0;

    bool operator==(const JointState&) const = default;   // C++20
};

int main() {
    JointState a{1.57, 0.3, 0.0};
    JointState b{1.57, 0.3, 0.0};
    JointState c{1.57, 0.3, 0.1};
    std::printf("a == b ? %s\n", (a == b) ? "true" : "false");
    std::printf("a == c ? %s\n", (a == c) ? "true" : "false");
    std::printf("a != c ? %s\n", (a != c) ? "true" : "false");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra eq2.cpp -o eq2
$ ./eq2
a == b ? true
a == c ? false
a != c ? true
```

`==` 하나를 defaulted로 선언했는데 `!=`까지 공짜로 나왔다 — C++20의 비교 연산자 재작성 규칙 덕분이고, `<` 계열까지 한 번에 얻는 삼중 비교 `<=>`는 [3.6](#/operator-overloading)에서 다룬다.

::: warn defaulted == 는 double 멤버에 == 를 쓴다
`= default` 비교는 각 멤버를 `==`로 비교한다. 멤버가 `double`이면 [1.2](#/types)에서 실측한 그 문제가 그대로 돌아온다 — 계산 경로가 다른 두 `position`은 수학적으로 같아도 `==`가 false일 수 있다(`0.1 + 0.2 != 0.3`). defaulted ==가 정당한 용도는 **비트 그대로 저장·복원되는 값의 동일성 확인**(설정 스냅샷, 테스트의 기대값 비교)이고, "두 자세가 같은 위치인가" 같은 물리량 비교는 epsilon 기반 함수로 따로 만들어야 한다 — 허용 오차를 정하는 법은 [9.8](#/numerics)의 주제다.
:::

## enum: 이름 붙은 정수의 두 얼굴

구조체가 "여러 값의 묶음"이라면, 열거형은 반대다 — **가질 수 있는 값이 몇 개로 정해진** 타입. 로봇은 이런 타입투성이다. 보행 상태, 모터 방향, 에러 코드. 이것을 `int` 상수 0, 1, 2로 표현하면 "3이 들어오면 뭐냐"는 질문에 코드가 답하지 못한다. C++에는 열거형이 **둘** 있다. C에서 온 구식 `enum`부터, 뭐가 문제인지 실측한다.

```cpp title="oldenum.cpp — 구식 enum은 이름을 바깥 스코프에 쏟는다"
enum MotorState { Idle, Running, Fault };
enum GaitPhase  { Swing, Stance, Idle };   // 두 번째 Idle
```

```console
$ g++ -std=c++20 -Wall -Wextra -c oldenum.cpp
oldenum.cpp:2:34: error: 'Idle' conflicts with a previous declaration
oldenum.cpp:1:19: note: previous declaration 'MotorState Idle'
```

`MotorState`의 `Idle`과 `GaitPhase`의 `Idle`은 다른 개념인데 공존하지 못한다. 구식 enum의 열거자는 enum 이름 안이 아니라 **둘러싼 스코프에 직접** 선언되기 때문이다 — 스코프 오염이다. 그래서 C 시대의 코드는 `MOTOR_STATE_IDLE`처럼 접두사를 손으로 붙였다. 타입 시스템이 할 일을 명명 규칙이 대신하는 형국이다.

두 번째 문제는 더 위험하다. 구식 enum은 **아무 정수·실수와 조용히 섞인다.**

```cpp title="oldenum2.cpp — 다른 enum끼리의 비교가 컴파일된다"
#include <cstdio>

enum MotorState { MotorIdle, Running, MotorFault };
enum ErrorCode  { Ok, Timeout, Overheat };

int main() {
    int x = Running;                       // enum -> int: 조용히 통과
    double d = MotorFault + 1.5;           // 산술에도 그냥 섞인다
    bool same = (Running == Timeout);      // 다른 enum끼리 비교
    std::printf("x = %d, d = %g, same = %d\n", x, d, same);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra oldenum2.cpp -o oldenum2
oldenum2.cpp:8:27: warning: arithmetic between enumeration type 'MotorState' and floating-point type 'double' is deprecated [-Wdeprecated-enum-float-conversion]
oldenum2.cpp:9:26: warning: comparison between 'enum MotorState' and 'enum ErrorCode' [-Wenum-compare]
$ ./oldenum2
x = 1, d = 3.5, same = 1
```

마지막 줄을 보라. "모터가 돌고 있다"와 "타임아웃"의 비교가 **true**다 — 둘 다 정수 1로 변환된 뒤 비교됐기 때문이다. 경고는 나왔지만 컴파일도 실행도 됐고, 경고를 흘려보내는 코드베이스에서 이 비교는 `if` 조건 안에 숨어 몇 달을 산다. 정수에 의미를 붙이려고 만든 타입인데, 그 의미가 비교 한 번에 증발한다.

::: hist 왜 이렇게 새는 타입이 됐나
C의 enum은 처음부터 "이름 붙은 int 상수"를 만드는 문법 설탕에 가까웠다 — C에는 네임스페이스도 강한 타입 구분도 없었으니 열거자가 바깥 스코프의 int 상수로 사는 게 자연스러웠다. C++은 C 코드를 그대로 컴파일해야 했기에 이 동작을 물려받았고, 고치는 대신 **새 열거형을 추가**했다. 그것이 C++11의 `enum class`다 — 기존 코드를 안 깨면서 새 코드에 올바른 기본값을 주는, C++ 진화의 전형적 패턴이다.
:::

## enum class: 상태를 타입에 새긴다

`enum class`는 구식 enum의 두 구멍을 정확히 막는다. 열거자는 타입 이름 안에 갇히고(`GaitState::Idle`), 정수로의 암묵 변환은 없다. [1.5](#/control-flow)의 상태 머신 예제에서 미리 썼던 `GaitState`를 이제 제대로 선언한다.

```cpp title="ec.cpp — 섞으려는 시도가 전부 컴파일 에러다"
#include <cstdint>

enum class GaitState : std::uint8_t { Idle, Standing, Walking, Fault };

int main() {
    int x = GaitState::Walking;            // ❌ 암묵 변환 없음
    bool b = (GaitState::Idle == 0);       // ❌ 정수와 비교 불가
    (void)x; (void)b;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c ec.cpp
ec.cpp:6:24: error: cannot convert 'GaitState' to 'int' in initialization
ec.cpp:7:31: error: no match for 'operator==' (operand types are 'GaitState' and 'int')
```

구식 enum에서 경고로 그쳤던 것들이 전부 **에러**가 됐다. "보행 상태를 정수와 비교하는 코드"는 이제 존재할 수 없다 — 실수의 가능성이 리뷰나 테스트가 아니라 타입 시스템에서 소멸했다.

선언에 붙인 `: std::uint8_t`는 저장에 쓸 정수 타입 — 기저 타입(underlying type) — 의 지정이다. 지정하지 않으면 `enum class`의 기저 타입은 `int`다. 실측:

```console
$ ./ecsize
sizeof(GaitStateDefault) = 4
sizeof(GaitState)        = 1
```

상태 4개에 4바이트는 낭비다 — 특히 이 값이 구조체 멤버로 들어가거나(방금 본 패딩과 곱해진다) 통신 패킷에 실릴 때. 상태·모드·에러 코드처럼 값이 몇 개뿐이고 직렬화될 열거형은 `: std::uint8_t`를 관례로 삼아라.

상태 머신과의 결합은 [1.5](#/control-flow)에서 이미 실측했다 — `enum class`를 분기하는 `switch`는 **모든 케이스 명시 + default 금지**로 쓰면, 나중에 `GaitState`에 상태를 추가했을 때 `-Wswitch`가 케이스를 빠뜨린 switch 전부를 컴파일 타임에 뽑아 준다. 그 규칙 위에서 상태 전이 함수는 이렇게 생긴다.

```cpp title="gait.cpp — 전이 규칙이 한 함수, 한 switch에 모인다"
#include <cstdint>
#include <cstdio>

enum class GaitState : std::uint8_t { Idle, Standing, Walking, Fault };

// 상태 전이 규칙이 한 함수에 모인다. 케이스 누락은 -Wswitch가 잡는다.
GaitState next_on_walk_cmd(GaitState s) {
    switch (s) {                       // default 없음 — 1.5의 규칙 그대로
    case GaitState::Idle:     return GaitState::Idle;      // 일어서기 전엔 못 걷는다
    case GaitState::Standing: return GaitState::Walking;
    case GaitState::Walking:  return GaitState::Walking;
    case GaitState::Fault:    return GaitState::Fault;     // Fault에서 탈출은 별도 절차
    }
    return GaitState::Fault;           // 도달 불가, 반환 경고 억제용
}

int main() {
    GaitState s = next_on_walk_cmd(GaitState::Standing);
    std::printf("standing -> walk cmd -> %d\n", static_cast<int>(s));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra gait.cpp -o gait
$ ./gait
standing -> walk cmd -> 2
```

"걷기 명령이 왔을 때 각 상태에서 무슨 일이 일어나는가"가 함수 하나에 전부 있고, 상태를 추가하면 컴파일러가 고칠 곳을 알려 준다. 헥사포드의 보행 제어기가 정확히 이 패턴 위에 서고, 상태가 늘어날수록 이 컴파일 타임 검증의 가치는 커진다.

## 경계에서 딱 한 번 벗긴다: enum class ↔ 정수

암묵 변환을 막았으니, **필요할 때는 명시적으로** 벗겨야 한다. 필요한 자리는 정해져 있다 — 열거형이 시스템의 경계를 넘어 바이트가 되는 곳. 통신 패킷, 로그, 직렬화다.

```cpp title="packet.cpp — 상태를 패킷 필드에 싣는다"
#include <cstdint>
#include <cstdio>

enum class GaitState : std::uint8_t { Idle, Standing, Walking, Fault };

struct StatusPacket {
    std::uint8_t robot_id;
    std::uint8_t gait;        // GaitState가 여기 실린다
    std::int16_t battery_mv;
};

int main() {
    GaitState s = GaitState::Walking;
    StatusPacket p{ .robot_id = 7,
                    .gait = static_cast<std::uint8_t>(s),   // 경계에서 딱 한 번
                    .battery_mv = 11840 };
    std::printf("packet = {%d, %d, %d}, sizeof = %zu\n",
                p.robot_id, p.gait, p.battery_mv, sizeof(p));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra packet.cpp -o packet
$ ./packet
packet = {7, 2, 11840}, sizeof = 4
```

이 절의 도구가 한 화면에 모였다 — designated initializer, 고정폭 멤버의 구조체(패딩 없이 정확히 4바이트), [1.4](#/casting)의 `static_cast`. 변환이 명시적이라는 것은 "여기서 타입의 보호를 의도적으로 벗는다"가 코드에 적혀 있다는 뜻이고, 리뷰어는 그 지점만 검사하면 된다.

`static_cast<std::uint8_t>(s)`에는 약점이 하나 있다 — 기저 타입을 선언에서 바꾸면 캐스트의 목적지도 같이 고쳐야 한다. 기저 타입을 코드로 물어보는 관용구가 그 약점을 없앤다.

```cpp title="조각: 기저 타입이 바뀌어도 따라가는 변환"
// C++20 관용구
auto raw20 = static_cast<std::underlying_type_t<GaitState>>(s);
// C++23
auto raw23 = std::to_underlying(s);
```

`std::to_underlying`은 위 관용구를 한 단어로 줄인 C++23 함수다. 이 책의 기준인 `-std=c++20`으로 컴파일하면 g++ 13.3이 정확히 그렇게 알려 준다 — 실측: `error: 'to_underlying' is not a member of 'std'`에 이어 `note: 'std::to_underlying' is only available from C++23 onwards`. 같은 파일을 `-std=c++23`으로 돌리면 통과하고, 두 방식의 결과 타입이 같음을 `is_same_v`로 확인했다(둘 다 `uint8_t`, 값 2). C++20에 머무는 동안은 `underlying_type_t` 관용구를 헬퍼 함수로 감싸 써라 — C++23 전환 때 몸통 한 줄만 바뀐다. 결과가 `uint8_t`이므로 그대로 `cout`에 넣으면 [1.2](#/types)에서 실측한 대로 문자가 나온다 — 출력엔 `static_cast<int>`를 한 번 더 거쳐라.

::: interview enum vs enum class
"enum class는 기존 enum과 무엇이 다른가, 왜 나왔는가"는 단골 질문이다. 답변 뼈대: ① **스코프** — 구식 enum의 열거자는 둘러싼 스코프로 새어 나가 이름 충돌을 만들지만(두 enum의 `Idle` 공존 불가, 에러 실측), enum class는 `GaitState::Idle`처럼 타입 안에 갇힌다. ② **타입 안전** — 구식은 정수로 암묵 변환되어 다른 enum·산술과 조용히 섞이지만(`Running == Timeout`이 true 실측), enum class는 `static_cast` 없이는 정수가 되지 않는다. ③ **기저 타입** — 둘 다 `: type` 지정이 가능하지만 enum class는 기본이 int로 못 박혀 전방 선언이 항상 가능하다. ④ 실무 결론 — 새 코드는 enum class가 기본값이고, 구식이 정당한 자리는 암묵 정수 변환 자체가 목적인 좁은 경우(비트 플래그 상수, 배열 인덱스 트릭)뿐이다. "경계에서는 static_cast나 C++23 std::to_underlying으로 명시적으로 벗긴다"까지 말하면 상급이다.
:::

## 요약

- 관련 값을 낱개 변수·병렬 배열로 들고 다니면 컴파일러가 지켜 주지 못한다(같은 타입 인자의 순서 바꿈이 조용히 컴파일된다). 구조체는 **의미의 단위**를 타입으로 만든다 — ROS 2 메시지도 결국 `.msg`에서 생성된 구조체다.
- 집성체의 중괄호 초기화에서 명시하지 않은 멤버는 **0으로 보장**되고, 중괄호가 아예 없으면 [1.3](#/variables)의 미정 상태다(실행마다 다른 쓰레기값 실측). 상태 구조체 멤버에는 기본값(`= 0.0`)을 박아 타입 차원에서 봉쇄하라.
- C++20 designated initializer는 **선언 순서를 지켜야** 한다(순서 위반은 에러 실측). 멤버가 셋을 넘으면 이름 붙여 초기화하라.
- `sizeof(구조체)`는 패딩 때문에 멤버 합보다 크다 — char/double/int가 배치에 따라 24 또는 16바이트(실측). 큰 멤버부터 배치하면 줄어드는 경향이 있고, "왜"는 [2.12](#/object-layout)에서.
- 구조체는 **값**이다. 대입은 전체 복사(실측), 함수 전달은 [1.6](#/functions) 규칙대로 읽기 전용이면 `const&`. `==`는 공짜가 아니며 C++20 `= default`로 위임한다 — 단 double 멤버의 `==` 함정은 그대로 남는다.
- 구식 enum은 스코프를 오염시키고(`Idle` 충돌 에러 실측) 정수와 조용히 섞인다(`Running == Timeout`이 true 실측). **새 코드는 enum class가 기본값이다.**
- 직렬화될 열거형은 `: std::uint8_t`로 기저 타입을 지정하라(sizeof 4 → 1 실측). 정수로 벗길 때는 경계에서 딱 한 번, `static_cast`나 `underlying_type_t` 관용구로 — `std::to_underlying`은 C++23부터다(g++ 13.3 실측).

::: quiz 연습문제
1번은 예측, 2번과 3번은 개념, 4번과 5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. 다음 두 선언의 차이를 말하고, 각각의 `js.velocity`를 읽으면 무슨 일이 일어나는지 답하라.

   ```cpp
   struct JointState { double position; double velocity; };
   JointState a{1.57};
   JointState b;
   ```

2. 팀 코드에서 `enum { OK, FAIL };`과 `enum class Result { OK, FAIL };`이 섞여 있다. 구식 쪽을 enum class로 바꾸자고 제안할 때 근거가 되는 실측 두 가지를 이 절에서 대라. 반대로, 바꾸면 새로 해야 할 일은 무엇인가?

3. `bool operator==(const JointState&) const = default;`를 붙인 `JointState`(멤버는 double 셋)로 "두 관절이 같은 자세인가"를 판정하는 코드가 리뷰에 올라왔다. 승인하면 안 되는 이유와 올바른 대안을 말하라.

4. (실습) 패딩 관찰: `char c; double d; int i;` 순서의 구조체와 `double d; int i; char c;` 순서의 구조체의 `sizeof`를 각각 **예측한 뒤**, 직접 쳐서 확인하라. 그다음 `char`를 하나 더 추가하되 한 번은 `c` 옆에, 한 번은 맨 앞에 넣어 크기가 어떻게 변하는지 관찰하라. 성공 기준: 예측과 실측의 차이를 패딩 위치로 설명할 수 있다.

5. (실습) enum class 변환 에러 재현: `enum class GaitState : std::uint8_t`를 선언하고 ① `int x = GaitState::Idle;`로 `cannot convert` 에러를 재현하라. ② 그 줄을 `static_cast`를 써서 고치고, ③ `std::to_underlying`을 쓴 버전을 `-std=c++20`과 `-std=c++23`으로 각각 컴파일해 보라. 성공 기준: ②가 `-Wall -Wextra`에서 경고 없이 통과하고, ③에서 C++20 에러 메시지의 `only available from C++23 onwards` note를 직접 확인한다.
:::

::: answer 해설
1. `a`는 집성체 부분 초기화 — `position`은 1.57, 명시하지 않은 `velocity`는 **0으로 보장**된다(표준의 값 초기화). `b`는 초기화가 없으므로 두 멤버 모두 미정 상태이고, `b.velocity`를 읽는 것은 **UB**다 — 이 절 실측에서 실행마다 다른 값(`6.93e-310`, `6.92e-310`)이 나왔고, 0이 나온 멤버조차 보장이 아니다.
2. 실측 근거 ① 스코프 오염: 구식 enum 둘이 `Idle`을 공유하지 못하고 `conflicts with a previous declaration` 에러가 났다 — `OK`, `FAIL` 같은 흔한 이름은 충돌 예약이다. ② 암묵 변환: 다른 enum끼리의 `Running == Timeout`이 경고만 내고 true로 평가됐다 — enum class면 컴파일 에러다. 바꾸면 할 일: 사용처를 `Result::OK`로 바꾸고, 정수로 쓰던 자리에 `static_cast`를 명시한다 — 그 캐스트가 드러나는 것 자체가 개선이다.
3. defaulted `==`는 멤버별 `==` 비교라서, double 멤버에는 [1.2](#/types)의 부동소수점 `==` 문제가 그대로 적용된다 — 계산 경로가 다르면 수학적으로 같은 자세도 false가 난다. 대안: 각 멤버의 차의 절대값을 허용 오차와 비교하는 `approx_equal(const JointState&, const JointState&, double tol)` 류의 함수를 따로 만든다. defaulted ==는 스냅샷 동일성 확인 같은 비트 단위 비교 용도로만 남긴다.
4. 실측 기준값(x86-64, g++ 13.3): `{char, double, int}`는 24, `{double, int, char}`는 16이다. char 하나를 기존 `c` 옆이나 맨 앞에 추가해도 패딩을 파먹을 뿐이라 크기는 24, 16 그대로다(실측) — "멤버 추가 = 크기 증가"가 아님을 눈으로 확인하는 것이 목적이다. 정렬 규칙으로 정확히 계산하는 법은 [2.12](#/object-layout)에서 배운다.
5. g++ 13.3 실측 기준: ①은 `error: cannot convert 'GaitState' to 'int' in initialization`. ②는 `int x = static_cast<int>(GaitState::Idle);` — 경고 없이 통과해야 한다. ③은 C++20에서 `'to_underlying' is not a member of 'std'` 에러와 `only available from C++23 onwards` note, C++23에서 통과. 에러 메시지가 해결책까지 알려 주는 사례다 — [0.3](#/first-build)에서 훈련한 대로 note까지 읽어라.
:::

이 절의 코드는 전부 짧다. 전부 직접 쳐라. 특히 `agg.cpp`는 두 번 실행해서 쓰레기값이 매번 달라지는 것을, `pad.cpp`는 멤버 순서를 이리저리 바꿔 가며 크기 변화를, `ec.cpp`는 에러 두 개를 눈으로 확인하라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, 5번 실습의 C++23 확인은 `g++ -std=c++23 -Wall -Wextra main.cpp -o main`이다.

**다음 절**: [1.9 헤더와 컴파일 단위](#/headers) — `JointState`를 여러 소스 파일에서 같이 쓰려면 어디에 선언해야 하는가. `#include`의 실체와 헤더 가드, 선언과 정의의 분리로 간다.
