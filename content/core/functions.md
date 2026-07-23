# 1.6 함수: 오버로딩과 인자 전달

::: lead
함수 정의 자체는 어느 언어에서나 비슷하다. C++에서 다른 것은 **호출 한 번의 비용이 시그니처에 따라 수십 배 달라진다**는 점, 그리고 같은 이름의 함수 여러 개 중 하나를 컴파일러가 규칙에 따라 고른다는 점이다. 이 절은 그 두 축이다 — 인자를 값으로 넘길 때 실제로 복사되는 바이트를 실측하고, 값/참조/const 참조의 선택 규칙을 표 하나로 만들고, [1.1](#/compile-model)에서 심볼 수준(`_Z3addii` vs `_Z3adddd`)으로 확인했던 오버로딩이 호출 지점에서는 어떤 규칙으로 해석되는지를 에러 메시지까지 재현하며 본다. 끝에서 기본 인자, `inline`의 진짜 의미, `[[nodiscard]]`까지 시그니처에 붙는 약속들을 정리한다.
:::

## 함수 하나가 8킬로바이트를 복사한다

라이다 스캔 한 프레임을 담는 구조체를 함수에 넘기는, 로봇 코드에서 매일 일어나는 일부터 본다. 거리 샘플 1000개면 `double` 기준 8000바이트다.

```cpp title="scan_cost.cpp — 값 전달 vs const 참조 전달"
#include <chrono>
#include <cstdio>

struct LidarScan {
    double ranges[1000];   // 8000바이트
    int    count;
};

// noinline: 인라인되면 전달 자체가 사라져 측정이 안 된다
__attribute__((noinline))
double first_by_value(LidarScan scan)       { return scan.ranges[0]; }

__attribute__((noinline))
double first_by_cref(const LidarScan& scan) { return scan.ranges[0]; }

int main() {
    LidarScan scan{};
    scan.count = 1000;
    for (int i = 0; i < 1000; ++i) scan.ranges[i] = 1.0 + i * 0.003;

    constexpr int N = 10'000'000;
    volatile double sink = 0;

    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < N; ++i) sink = first_by_value(scan);
    auto t1 = std::chrono::steady_clock::now();
    for (int i = 0; i < N; ++i) sink = first_by_cref(scan);
    auto t2 = std::chrono::steady_clock::now();

    auto ms = [](auto d) {
        return std::chrono::duration<double, std::milli>(d).count();
    };
    std::printf("by value      : %8.1f ms\n", ms(t1 - t0));
    std::printf("by const ref  : %8.1f ms\n", ms(t2 - t1));
    std::printf("(check) sink  = %f\n", sink);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 scan_cost.cpp -o scan_cost
$ ./scan_cost
by value      :    832.7 ms
by const ref  :     16.2 ms
(check) sink  = 1.000000
```

(이 절의 모든 수치와 출력은 g++ 13.3 / Ubuntu 24.04 x86-64 실측이다. 절대값은 기기마다 다르지만 배율의 그림은 같다.)

천만 번 호출에 값 전달은 833ms, const 참조는 16ms — **약 50배** 차이다. 호출 한 번으로 환산하면 값 전달이 약 83ns, 참조가 약 1.6ns. 이유는 시그니처에 그대로 적혀 있다. `LidarScan scan`이라고 쓰는 순간 **함수의 파라미터는 호출자가 준 인자의 복사본**이고, 컴파일러는 호출마다 8004바이트를 새 스택 공간에 통째로 복사하는 코드를 만든다. `const LidarScan&`은 별명이다 — [2.3](#/references)에서 해부할 레퍼런스의 실체는 주소 하나(8바이트)를 넘기는 것이라, 구조체가 8KB든 8MB든 전달 비용이 같다.

이 함수가 1kHz 제어 루프 안에 있다면 값 전달 하나가 주기마다 83ns를 태운다. 한 개면 무해하지만, 이런 시그니처가 콜스택에 다섯 단 쌓이면 복사도 다섯 번 일어난다. 그리고 이 비용은 프로파일러 없이는 안 보인다 — 코드 어디에도 "복사하라"는 문장이 없기 때문이다. **C++에서 복사는 문법이 아니라 시그니처가 일으킨다.**

::: perf 본문이 무거우면 복사 비용은 숨는다, 사라지는 게 아니라
같은 구조체로 함수 본문이 1000개 원소를 전부 도는 버전(최솟값 탐색)을 백만 번 호출로 실측하면 값 전달 1660ms, const 참조 1394ms다. 배율은 50배에서 1.2배로 줄었지만 절대 차이는 여전히 호출당 수백 ns다. 본문이 무거운 함수에서 복사 비용이 안 보이는 것은 희석이지 소멸이 아니다 — 그래서 판단 기준은 "본문이 무거운가"가 아니라 아래의 규칙 표다.
:::

## 인자 전달의 세 형태와 선택 규칙

C++의 인자 전달은 세 형태다. 값(`T`), 참조(`T&`), const 참조(`const T&`). 선택 기준은 두 질문으로 끝난다 — **크기가 작은가? 함수가 인자를 수정하는가?**

작은 타입부터. "참조가 복사보다 싸다"를 모든 타입에 일반화하면 틀린다. `double` 하나로 실측한다.

```cpp title="small_cost.cpp — 조각: 핵심 두 함수"
__attribute__((noinline)) double sq_val(double x)        { return x * x; }
__attribute__((noinline)) double sq_ref(const double& x) { return x * x; }
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 small_cost.cpp -o small_cost
$ ./small_cost
double by value :    42.3 ms
double by cref  :   132.2 ms
```

1억 번 호출에 값 전달 42ms, const 참조 132ms — 작은 타입에서는 **참조가 3배 느리다.** `double`은 레지스터 하나에 실려 전달되는데, 참조로 넘기면 주소를 넘기고 함수 안에서 그 주소를 따라 메모리를 한 번 더 읽어야 하기 때문이다. 게다가 참조는 별명이라 컴파일러가 "이 값이 함수 안에서 안 바뀐다"를 증명하기 어려워 최적화도 방해받는다. 결론: **레지스터에 들어가는 것(정수, 부동소수점, 포인터, 그 정도 크기의 작은 구조체)은 값으로 넘겨라.**

수정 여부가 두 번째 축이다. 함수가 인자를 읽기만 하면 `const T&` — 호출자의 물건에 손대지 않겠다는 약속이 시그니처에 새겨지고, 컴파일러가 그 약속을 강제한다. 함수가 인자를 수정해야 하면 `T&`다. 표로 못 박는다.

| 상황 | 형태 | 예 |
| --- | --- | --- |
| 작은 타입 (레지스터에 들어감) | `T` 값 | `double gain`, `int joint_id`, `const char* name` |
| 큰 타입, 읽기만 한다 | `const T&` | `const LidarScan& scan`, `const std::string& frame` |
| 큰 타입, 수정한다 | `T&` | `void normalize(Pose& p)` |
| 결과를 만들어 준다 | 반환값 | `Pose compute_target(...)` — 출력 인자 대신 |

마지막 줄이 이 표에서 가장 자주 어겨지는 규칙이다. "결과를 담을 변수를 참조로 받아 채워 주는" 출력 인자 스타일은 두 가지 이유로 반환값에 밀린다. 첫째, 호출 지점에서 읽히지 않는다 — `compute(target, scan)`을 보고 어느 쪽이 입력이고 어느 쪽이 출력인지 시그니처를 찾아봐야 안다. `Pose target = compute(scan)`은 그 자체로 읽힌다. 둘째, 출력 인자는 "미리 만들어 둔 객체"를 요구하므로 그 객체의 반쯤 초기화된 상태가 존재하게 된다. 반환값에는 그 상태가 없다. "반환이 복사라서 느리지 않냐"는 반론은 다음 절에서 실측으로 무너뜨린다.

이 표가 실제 로봇 코드의 관례 그대로다. rclcpp의 `publish`는 메시지를 `const&`로 받고, Nav2의 컨트롤러 플러그인 인터페이스는 현재 포즈와 속도를 `const&`로 받는다. 라이다 스캔·포인트클라우드·궤적처럼 큰 메시지를 값으로 받는 시그니처를 쓰면 위에서 잰 복사 비용이 콜백이 불릴 때마다, 즉 센서 주기마다 청구된다.

::: tip 수정하는 인자에 포인터를 쓰는 유파도 있다
`T&` 대신 `T* out`을 써서 호출 지점이 `compute(&target, scan)`으로 보이게 하는 스타일(구글 C++ 스타일의 오랜 관례)도 있다. "호출부에서 수정이 보인다"는 실익은 있지만, 널이 들어올 수 있게 되는 대가가 있다. 이 책은 표준 관례를 따른다 — 수정하면 `T&`, 그보다 먼저 반환값을 검토하라.
:::

::: interview "언제 값으로 넘기고 언제 const 참조로 넘기는가"
시그니처 설계 감각을 재는 단골 질문이다. 답변 뼈대: ① 기본 원칙은 크기다 — 레지스터에 들어가는 작은 타입(정수·실수·포인터)은 값 전달이 가장 싸고, 큰 객체는 `const T&`로 복사를 피한다. ② "작은 타입도 참조가 낫지 않냐"에는 실측으로 답한다 — 참조는 간접 참조 한 단계가 추가돼 `double`에서는 오히려 3배 느렸고, 앨리어싱 때문에 최적화도 막는다. ③ 경계가 애매한 중간 크기(예: 16~32바이트 구조체)는 ABI와 인라인 여부에 따라 갈리므로 "프로파일링으로 결정한다"고 말하면 정직하고 정확하다. ④ 이동 시맨틱까지 아는 티를 내려면 "인자를 함수가 소유해야 하는 경우에는 값으로 받고 move한다"를 덧붙인다 — 그 패턴은 [2.7](#/move-semantics)의 주제다.
:::

## 반환은 생각보다 싸다 — 단, 지역 변수의 참조는 금지

"큰 구조체를 값으로 반환하면 복사가 일어나니 출력 인자를 쓰자"는 오래된 통념을 실측으로 검사한다. 복사 생성자에 로그를 심어 복사가 실제로 일어나는지 세어 본다.

```cpp title="rvo.cpp"
#include <cstdio>

struct LidarScan {
    double ranges[1000];
    int    count;
    LidarScan() : ranges{}, count(0) { std::printf("생성\n"); }
    LidarScan(const LidarScan&) { std::printf("복사!\n"); }
};

LidarScan make_scan() {
    LidarScan s;          // 지역 변수를
    s.count = 1000;
    return s;             // 값으로 반환한다 — 복사가 일어날까?
}

int main() {
    LidarScan scan = make_scan();
    std::printf("count = %d\n", scan.count);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra rvo.cpp -o rvo
$ ./rvo
생성
count = 1000
```

`복사!`가 한 번도 찍히지 않았다. 8KB 구조체를 값으로 반환했는데 복사가 0번이다. 컴파일러가 **반환값 최적화(RVO, return value optimization)** 를 적용해, `make_scan`의 지역 변수 `s`를 처음부터 호출자의 `scan` 자리에 직접 지어 버렸기 때문이다 — 반환 시점에 옮길 것이 아예 없다. 이 복사 생략(copy elision)이 언제 보장되고 언제 컴파일러 재량인지, 생략이 안 될 때 이동 시맨틱이 어떻게 받쳐 주는지는 [2.7 이동 시맨틱과 rvalue 레퍼런스](#/move-semantics)에서 제대로 다룬다. 지금 챙길 결론은 하나다. **"결과는 반환값으로"라는 표의 마지막 줄은 성능을 희생하는 규칙이 아니다.**

반환에서 진짜 조심할 것은 따로 있다. 반환을 싸게 만들겠다고 지역 변수의 **참조**를 반환하는 것이다.

```cpp title="retlocal.cpp — ❌ 절대 금지"
#include <iostream>

const std::string& make_label(int id) {
    std::string label = "joint_" + std::to_string(id);
    return label;   // label은 함수가 끝나는 순간 소멸한다
}

int main() {
    const std::string& s = make_label(3);
    std::cout << s << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra retlocal.cpp -o retlocal
retlocal.cpp:6:12: warning: reference to local variable 'label' returned [-Wreturn-local-addr]
    6 |     return label;   // label은 함수가 끝나는 순간 소멸한다
      |            ^~~~~
$ ./retlocal
Segmentation fault (core dumped)
```

`label`은 `make_label`의 스택 프레임에 사는 지역 변수다. 함수가 반환하는 순간 소멸하고, 반환된 참조는 죽은 객체의 별명 — 댕글링 참조가 된다. 그것을 읽는 것은 미정의 동작이다. 이 환경에서는 세그폴트로 죽어 줬지만, [1.2](#/types)에서 본 UB의 성질 그대로 **멀쩡히 그럴듯한 값이 나오는 날도 있고, 그날이 더 나쁜 날이다.** g++가 `-Wall`만으로 `-Wreturn-local-addr` 경고를 준 것에 주목하라 — 이 경고를 에러로 취급해라. 댕글링의 전체 지형과 새니타이저로 잡는 법은 [2.11](#/ub-sanitizers)의 몫이다.

::: danger 참조 반환 자체가 금지는 아니다
멤버 함수가 멤버를 참조로 반환하는 것(`std::vector`의 `operator[]`가 대표다)은 정당하고 흔하다 — 객체가 함수보다 오래 살기 때문이다. 금지는 정확히 하나, **함수가 끝나면 죽는 것의 참조/포인터를 반환하는 것**이다. "이 참조가 가리키는 것은 언제 죽는가"를 시그니처를 볼 때마다 물어라. 이 질문이 [2.5 RAII](#/raii)부터 [5.8 string_view](#/views)까지 계속 돌아온다.
:::

## 오버로딩: 컴파일러는 어느 함수를 고르는가

[1.1](#/compile-model)에서 오버로딩의 링커 쪽 절반을 봤다. `add(int, int)`와 `add(double, double)`은 맹글링을 거쳐 `_Z3addii`와 `_Z3adddd`라는 서로 다른 심볼이 되므로 공존할 수 있다 — 오버로딩은 그 구현 위에 서 있는 언어 기능이다. 이 절은 나머지 절반이다. 호출 지점에서 **컴파일러가 어느 오버로드를 고르는가**, 즉 오버로드 해석(overload resolution)이다.

전체 규칙은 표준에서 가장 긴 장 중 하나지만, 실무에서 만나는 대부분은 우선순위 세 단계로 정리된다. **정확 일치 > 승격 > 변환.** 인자 타입이 파라미터와 정확히 같으면 그것이 이기고, 아니면 승격([1.2](#/types)에서 본 `char`→`int` 정수 승격, `float`→`double` 부동소수점 승격)으로 맞는 쪽, 그다음에야 표준 변환(`int`→`double`, `double`→`int` 같은)이다. 실측:

```cpp title="pick.cpp"
#include <cstdio>
#include <cstdint>

void f(int x)    { std::printf("f(int)    <- %d\n", x); }
void f(double x) { std::printf("f(double) <- %f\n", x); }

int main() {
    char c = 'a';
    std::uint8_t u = 7;
    float g = 0.25f;
    f(c);   // char  -> ?
    f(u);   // uint8 -> ?
    f(g);   // float -> ?
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra pick.cpp -o pick
$ ./pick
f(int)    <- 97
f(int)    <- 7
f(double) <- 0.250000
```

세 호출 모두 정확 일치가 없다. `char`와 `uint8_t`는 **승격**으로 `int`가 되므로 `f(int)`, `float`는 **승격**으로 `double`이 되므로 `f(double)`이다. 셋 다 변환까지 내려가지 않고 승격 단계에서 결판났다. [1.2](#/types)의 bool 함정 — 문자열 리터럴이 `std::string` 오버로드 대신 bool 오버로드로 갔던 사건 — 도 같은 원리다. 포인터→bool은 표준 변환이고 `const char*`→`std::string`은 사용자 정의 변환인데, 표준 변환이 사용자 정의 변환보다 항상 우선한다.

승격과 변환의 서열 차이는 리터럴 `0`에서 함정이 된다. 위의 `f(int)`/`f(double)` 쌍에 `0`을 넘기면?

```console
$ ./pick2
f(int)    <- 0        <- f(0)    : 0은 int 리터럴, 정확 일치
f(double) <- 0.500000 <- f(0.5)  : 0.5는 double 리터럴, 정확 일치
```

`0`의 타입은 `int`다([1.2](#/types)의 리터럴 규칙). 게인 0.0을 주려던 손가락이 `set_gain(0)`을 치면 double 버전이 아니라 **int 버전이 정확 일치로 뽑힌다.** 두 오버로드가 같은 일을 하면 무해하지만, int 버전이 "정수 프리셋 번호", double 버전이 "게인 값"처럼 다른 의미라면 이 오타는 컴파일도 실행도 조용한 논리 버그다. 오버로드 집합 안의 함수들은 **같은 의미의 일**을 해야 한다 — 이것이 오버로딩 남용을 막는 제1 설계 규칙이다.

어느 단계로도 승부가 안 나면 컴파일러는 추측하지 않고 에러를 낸다.

```cpp title="ambig.cpp — 조각: 선언 둘과 호출 하나"
void log_value(long v);
void log_value(float v);

log_value(3.14);   // double 리터럴 — 어느 쪽?
```

```console
$ g++ -std=c++20 -c ambig.cpp
ambig.cpp:4:14: error: call of overloaded 'log_value(double)' is ambiguous
    4 |     log_value(3.14);   // double 리터럴
      |     ~~~~~~~~~^~~~~~
ambig.cpp:1:6: note: candidate: 'void log_value(long int)'
ambig.cpp:2:6: note: candidate: 'void log_value(float)'
```

`double`→`long`도 변환, `double`→`float`도 변환 — 같은 서열이 둘이면 **모호성(ambiguity) 에러**다. `f(int)`/`f(double)` 쌍에 `3L`을 넘겨도 같은 이유로 죽는다(`long`→`int`, `long`→`double` 둘 다 변환. g++ 13.3 실측으로 `call of overloaded 'set_gain(long int)' is ambiguous`). 에러 메시지가 후보(`candidate`)를 전부 나열해 주므로, 읽는 법은 링커 에러 때와 같다 — 메시지를 믿고 후보 목록에서 서열을 따져라. 해소는 호출자 캐스팅(`log_value(static_cast<float>(3.14))`)보다 **모호하지 않은 오버로드를 추가하거나 이름을 갈라 주는 쪽**이 근본 처방이다.

::: warn 오버로드 해석은 컴파일 타임, 반환 타입은 무관
해석은 **인자 타입만으로** 컴파일 타임에 끝난다. 반환 타입만 다른 두 함수는 오버로드가 될 수 없고(`int get();`과 `double get();`은 재선언 충돌 에러다), 실행 시점의 값이 무엇인지도 무관하다. "런타임에 타입 보고 고르는 것"은 오버로딩이 아니라 [3.4 가상함수](#/virtual-vtable)의 동적 디스패치이고, 두 메커니즘을 섞어 설명하면 면접에서 바로 걸린다.
:::

## 기본 인자: 선언에 한 번만

파라미터에 기본값을 주면 호출자가 뒤쪽 인자를 생략할 수 있다. 규칙은 하나만 외우면 된다 — **기본값은 한 번만 적는다.** 선언과 정의가 분리돼 있을 때 양쪽에 적으면 어떻게 되는지 실측한다.

```cpp title="defarg.cpp"
// 선언에서 기본값을 줬는데
void move_to(double x, double y, double speed = 0.5);

// 정의에서 또 주면?
void move_to(double x, double y, double speed = 0.5) {
    (void)x; (void)y; (void)speed;
}
```

```console
$ g++ -std=c++20 -c defarg.cpp
defarg.cpp:5:6: error: default argument given for parameter 3 of 'void move_to(double, double, double)' [-fpermissive]
defarg.cpp:2:6: note: previous specification in 'void move_to(double, double, double)' here
```

같은 값이라도 두 번 적으면 에러다. 그러면 어느 쪽에 적는가 — **선언 쪽, 즉 헤더다.** 이유는 기본 인자의 동작 방식에 있다. `move_to(1.0, 2.0)`이라는 호출을 만나면 컴파일러가 그 자리에서 `move_to(1.0, 2.0, 0.5)`로 **채워 넣는다.** 채워 넣으려면 호출 지점을 컴파일할 때 기본값이 보여야 하고, [1.1](#/compile-model)에서 봤듯 호출 지점에 보이는 것은 정의가 아니라 선언이다. 선언과 정의를 헤더/소스로 나누는 구조는 [1.9](#/headers)에서 세운다.

"호출 지점에서 채워 넣는다"는 사실에는 뇌관이 하나 숨어 있다. 기본값이 함수가 아니라 **호출부의 정적 타입**에 붙어 다닌다는 뜻이라, 가상 함수의 기본 인자를 파생 클래스에서 바꾸면 "부모의 기본값 + 자식의 함수 본문"이라는 괴물 조합이 나온다. 그 함정은 vtable을 이해한 뒤 [3.4](#/virtual-vtable)에서 터뜨린다 — 지금은 "가상 함수에는 기본 인자를 주지 마라"만 가져가라.

::: note 기본 인자 vs 오버로드
`move_to(x, y)`와 `move_to(x, y, speed)` 두 오버로드를 두는 것과 기본 인자 하나는 호출자 입장에서 같아 보인다. 파라미터가 하나 생략되는 정도면 기본 인자가 간결하고, 생략 조합이 여러 개거나 생략 시의 동작이 "기본값 대입"으로 표현이 안 되면(다른 멤버에서 값을 계산해 온다든가) 오버로드가 맞다. 판단 기준은 "생략된 호출의 의미를 값 하나로 말할 수 있는가"다.
:::

## inline의 진짜 의미

`inline`을 "이 함수를 인라인 확장해서 빠르게 하라"는 지시로 읽는 것은 수십 년 묵은 오해다. 현대 컴파일러는 인라인 확장 여부를 비용 모델로 스스로 판단하며, `inline`이 붙었든 말든 확장할 함수는 하고 안 할 함수는 안 한다(위 벤치마크에서 확장을 **막으려고** `noinline` 속성까지 써야 했던 것을 봤다). 오늘날 `inline`의 실제 의미는 링크 규칙 쪽에 있다: **"이 정의가 여러 번역 단위에 중복돼 나타나도 하나의 정의 규칙(ODR) 위반으로 치지 마라"**는 허가다. 헤더에 함수 정의를 넣으면 그 헤더를 include한 모든 `.cpp`에 같은 정의가 복제되는데, `inline`이 그것을 합법으로 만든다. 이 허가가 왜 필요하고 링커가 중복을 어떻게 접는지는 [1.10 네임스페이스와 링크리지](#/linkage)에서 심볼 수준으로 확인한다.

## [[nodiscard]]: 버려지는 반환값을 잡는다

출력 인자 대신 반환값을 쓰라고 했으니, 반환값이 **버려지는** 경우를 막을 장치가 필요하다. 에러를 반환값으로 알리는 함수에서 이 문제가 실전 사고가 된다.

```cpp title="nodiscard.cpp"
#include <cstdio>

enum class MotorError { ok, timeout, overcurrent };

[[nodiscard]] MotorError set_torque(int joint, double nm) {
    if (nm > 8.0) return MotorError::overcurrent;   // 한계 초과
    std::printf("joint %d <- %.1f Nm\n", joint, nm);
    return MotorError::ok;
}

int main() {
    set_torque(2, 12.0);   // 반환값을 버렸다 — 과전류 에러가 증발한다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra nodiscard.cpp -o nodiscard
nodiscard.cpp:12:15: warning: ignoring return value of 'MotorError set_torque(int, double)', declared with attribute 'nodiscard' [-Wunused-result]
$ ./nodiscard
$
```

실행 출력이 비어 있는 것을 보라. 토크 12Nm은 한계를 넘어 `overcurrent`가 반환됐고, 모터에는 아무 명령도 가지 않았는데, 호출부는 그 사실을 모른 채 다음 줄로 갔다. 로봇은 "명령을 보냈다고 믿는 코드"와 "명령을 받은 적 없는 모터"로 갈라진다 — 다리 하나가 허공에 뜬 채 보행 사이클이 도는 종류의 사고이고, 원인은 크래시가 아니라 **조용히 버려진 반환값**이라 로그에도 안 남는다. `[[nodiscard]]`(C++17)는 이 무시를 컴파일 타임 경고로 끌어올린다. 에러 코드·핸들·소유권을 반환하는 함수에는 습관처럼 붙여라. 정말 의도적으로 버릴 때만 `(void)set_torque(...)`로 캐스팅해 "알고 버린다"를 코드에 남긴다(g++ 13.3 실측으로 경고가 사라진다).

이 관행은 로봇 스택의 표준이기도 하다. ROS 2의 C 코어 라이브러리 rcl은 `rcl_ret_t` 에러 코드를 반환하는 API에 같은 역할의 어노테이션(`RCL_WARN_UNUSED`)을 붙여 두었고, C++ 표준 라이브러리도 C++20부터 곳곳에 `[[nodiscard]]`를 심었다 — `v.empty()`를 "비워라"로 착각하고 호출하면 g++ 13.3에서 `ignoring return value ... declared with attribute 'nodiscard'` 경고가 난다(`empty`는 "비어 있는가"를 **묻는** 함수다. 비우는 것은 `clear`).

## 요약

- 값 전달 파라미터는 복사본이다. 8000바이트 구조체 실측: 값 전달 호출당 약 83ns vs const 참조 약 1.6ns — **50배**. 복사는 문법이 아니라 시그니처가 일으킨다.
- 작은 타입은 반대다. `double` 실측에서 const 참조가 값 전달보다 3배 느렸다(간접 참조 비용). 규칙: **작으면 값, 크고 읽기만 하면 `const&`, 수정하면 `&`, 결과는 반환값.**
- 값 반환은 RVO 덕에 싸다 — 8KB 구조체를 반환해도 복사 0회 실측. 상세는 [2.7](#/move-semantics). 반대로 지역 변수의 **참조** 반환은 댕글링이다 — `-Wreturn-local-addr` 경고를 에러로 취급하라(실측: 경고 후 세그폴트).
- 오버로딩은 맹글링([1.1](#/compile-model)) 위에 선 기능이고, 해석 서열은 **정확 일치 > 승격 > 변환**이다. `char`·`uint8_t`는 int로, `float`는 double로 승격돼 그쪽 오버로드로 간다.
- 같은 서열의 후보가 둘이면 모호성 에러다(`double` 인자에 `long`/`float` 후보 실측). 리터럴 `0`은 int라 `f(int)`가 정확 일치로 이긴다 — int/double 오버로드가 다른 의미의 일을 하면 조용한 버그가 된다.
- 기본 인자는 **한 번만, 선언(헤더)에** 적는다 — 호출 지점에서 컴파일러가 채워 넣기 때문이다. 가상 함수에는 주지 마라([3.4](#/virtual-vtable)에서 이유를 본다).
- `inline`은 "빨라져라"가 아니라 "중복 정의를 ODR 위반으로 치지 마라"다 — [1.10](#/linkage).
- 에러 코드를 반환하면 `[[nodiscard]]`를 붙여라. 버려진 반환값은 로그도 없이 증발한다 — 모터 명령이 안 간 채 도는 제어 루프가 그 결과다.

::: quiz 연습문제
1~2번은 개념·예측, 3~5번은 네 컴퓨터에서 에러와 경고를 직접 재현하는 실습이다.

1. 다음 파라미터 각각에 값/`const&`/`&`/반환값 중 무엇을 쓸지 고르고 근거를 한 문장씩 대라. (a) 관절 게인 `double` (b) 8KB `LidarScan`, 읽기만 함 (c) 호출자의 `Pose`를 정규화해 고침 (d) 새 궤적을 계산해 돌려줌.

2. `void f(int);`와 `void f(double);`이 있을 때 다음 각 호출의 결과(어느 쪽 / 에러)를 예측하고 근거 서열을 대라: `f('a')`, `f(0.5f)`, `f(0)`, `f(3L)`.

3. (실습) 모호성 재현: `void log_value(long);`과 `void log_value(float);`을 선언하고 `log_value(3.14);`를 호출해 `is ambiguous` 에러를 재현하라. 그다음 에러의 `candidate` 목록을 읽고, 캐스팅 없이 이 호출이 컴파일되게 만드는 오버로드 하나를 추가하라. 성공 기준: 추가한 오버로드가 정확 일치로 뽑혀 에러가 사라진다.

4. (실습) `[[nodiscard]]` 재현: 본문의 `set_torque`를 그대로 치고 `g++ -std=c++20 -Wall -Wextra`로 경고를 재현하라. 그다음 ① 반환값을 변수로 받아 검사하는 버전 ② `(void)` 캐스팅 버전 두 가지로 경고를 없애 보라. 성공 기준: 경고가 사라진 두 버전의 의미 차이를 한 문장으로 말할 수 있다.

5. (실습) 지역 참조 반환: `retlocal.cpp`를 치기 전에 실행 결과를 예측하고, 컴파일해서 `-Wreturn-local-addr` 경고를 확인한 뒤 실행하라. 그다음 반환 타입을 `const std::string&`에서 `std::string`으로 바꿔 다시 실행하라. 성공 기준: 값 반환 버전이 경고 없이 올바른 출력을 내고, 그 버전이 느리지 않은 이유(RVO)를 설명할 수 있다.
:::

::: answer 해설
1. (a) 값 — `double`은 레지스터로 전달되며, 실측에서 참조가 3배 느렸다. (b) `const LidarScan&` — 8KB 복사(호출당 약 83ns)를 피하고 수정 안 함을 시그니처에 새긴다. (c) `Pose&` — 호출자의 객체 자체를 고쳐야 하므로 참조, 단 "고친 결과를 돌려주는" 설계로 바꿀 수 있으면 반환값이 먼저다. (d) 반환값 — RVO로 복사가 생략되므로 출력 인자보다 느리지 않고, 호출부가 읽힌다.
2. `f('a')` → `f(int)` (char→int는 **승격**). `f(0.5f)` → `f(double)` (float→double은 승격). `f(0)` → `f(int)` (0은 int 리터럴, **정확 일치**). `f(3L)` → **모호성 에러** (long→int, long→double 둘 다 **변환**으로 동률. g++ 13.3 실측: `call of overloaded 'f(long int)' is ambiguous`).
3. `3.14`는 double이고 double→long, double→float 둘 다 변환이라 동률이다. `void log_value(double);`을 추가하면 정확 일치가 생겨 해소된다. 이것이 캐스팅보다 나은 처방인 이유: 앞으로의 모든 호출 지점이 고쳐진다.
4. 실측 경고는 `ignoring return value of 'MotorError set_torque(int, double)', declared with attribute 'nodiscard' [-Wunused-result]`. ①은 에러를 **처리**하는 것이고 ②는 에러를 **알고도 버린다**고 기록하는 것이다 — 컴파일러에게는 둘 다 경고 해소지만, 리뷰어에게 전하는 의미가 다르다.
5. g++ 13.3 실측: 경고 후 실행하면 이 환경에서는 세그폴트지만, UB이므로 멀쩡한 출력이 나와도 고쳐야 한다는 점이 핵심이다. `std::string` 값 반환 버전은 RVO로 지역 변수가 호출자 자리에 직접 생성되므로 복사 비용 걱정 없이 올바르다 — 본문 `rvo.cpp`에서 복사 생성자가 0번 불린 것이 그 증거다.
:::

이 절의 코드는 전부 네 IDE에서 직접 쳐라. 특히 `scan_cost.cpp`는 수치를 네 기기에서 다시 재고(배율이 유지되는지 보라), `retlocal.cpp`와 `nodiscard.cpp`는 경고 메시지를 소리 내 읽어라 — 이 두 경고를 알아보는 눈이 이 절의 진짜 산출물이다. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -O2 main.cpp -o main && ./main`이다.

**다음 절**: [1.7 배열과 문자열](#/arrays-strings) — 함수에 배열을 넘기면 크기 정보가 증발하는 붕괴(decay)부터, `std::string`이 그 문제를 어떻게 끝냈는지까지.
