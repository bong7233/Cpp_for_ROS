# 1.2 타입 시스템: 정수, 부동소수점, 문자

::: lead
[1.1](#/compile-model)에서 소스가 실행파일이 되는 과정을 봤다. 이 절은 그 코드가 다루는 데이터의 최소 단위, 타입이다. C++의 기본 타입은 하드웨어를 거의 그대로 노출한다 — 그래서 빠르고, 그래서 위험하다. `int`가 몇 바이트인지 표준이 정하지 않았다는 사실에서 출발해, 부호가 다른 정수를 섞을 때 조용히 일어나는 일, `double`이 0.1을 저장하지 못한다는 사실, 그리고 이 책에서 처음 만나는 **미정의 동작(UB)** 까지 간다. 로봇 코드에서 타입 선택 실수는 로그에 이상한 숫자가 찍히는 정도로 끝나지 않는다 — 모터가 반대로 돈다.
:::

## 사고는 대입 한 줄에서 시작된다

정의부터 외우기 전에, 타입을 잘못 섞으면 무슨 일이 나는지부터 본다. 속도 명령은 부호 있는 정수로 계산하고(후진이 있으니 음수가 필요하다), 모터 드라이버의 duty 레지스터는 8비트 부호 없는 정수를 받는 흔한 구성이다.

```cpp title="motor.cpp — 후진 명령이 어디로 가는가"
#include <cstdint>
#include <iostream>

int main() {
    int velocity_cmd = -100;               // 후진 100
    std::uint8_t duty = velocity_cmd;      // 드라이버 레지스터는 8비트
    std::cout << "duty = " << static_cast<int>(duty) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra motor.cpp -o motor
$ ./motor
duty = 156
```

컴파일은 침묵했고, 실행도 멀쩡히 됐다. 그런데 후진 100 명령이 **전진 156**이 됐다. 8비트 duty의 최대가 255이니 156은 60%가 넘는 출력이다. 이 값이 실제 드라이버에 쓰였다면 로봇은 후진하라는 명령에 전속력의 절반 이상으로 앞으로 튀어 나간다.

무슨 일이 일어났는지는 비트를 보면 명확하다. x86-64에서 `int`는 32비트이고, 음수는 2의 보수(two's complement)로 표현된다 — 각 비트 자리값은 그대로 두고 최상위 비트에만 음의 가중치를 주는 방식이다. `-100`의 비트 패턴에서 하위 8비트만 잘라 부호 없는 수로 읽으면 156이 나온다.

```text nolines
int velocity_cmd = -100 (32-bit, two's complement)

  11111111 11111111 11111111 10011100
                             ^^^^^^^^
                             keep low 8 bits only

uint8_t duty            =    10011100  = 156
```

::: danger 이 변환은 에러도 경고도 아니다
`int`를 `uint8_t`에 대입하는 것은 C++에서 **완전히 합법**이고, 기본 경고(`-Wall -Wextra`)로는 잡히지 않는다. 값이 목적지 타입에 안 들어가면 조용히 하위 비트만 남는다. 이것을 잡는 플래그가 `-Wconversion`인데, 아래 '부호의 지뢰밭'에서 실측한다. 하드웨어 레지스터에 값을 쓰는 코드라면 이 플래그 없이 커밋하지 마라.
:::

이런 대입이 왜 컴파일러를 그냥 통과하는가. C++의 기본 타입과 변환 규칙은 C에서 왔고, C는 1970년대 하드웨어에서 어셈블리를 대체하려던 언어다. 타입 간 암묵 변환은 그 시절엔 편의였지만 지금은 지뢰밭이다. 변환 규칙의 전모는 [1.4 캐스팅과 타입 변환](#/casting)에서 다루고, 이 절은 먼저 그 지뢰밭의 지도를 그린다.

## 정수 타입: 표준은 크기를 정하지 않았다

C++ 표준은 `int`가 몇 바이트인지 **정하지 않았다.** 정한 것은 최소 보장과 순서뿐이다: `char`는 정확히 1바이트(이것이 바이트의 정의다), `short`와 `int`는 최소 16비트, `long`은 최소 32비트, `long long`은 최소 64비트, 그리고 `sizeof(char) <= sizeof(short) <= sizeof(int) <= sizeof(long) <= sizeof(long long)`. 나머지는 플랫폼 ABI가 정한다.

그러니 크기는 외우는 게 아니라 측정하는 것이다. 이 책의 기준 환경에서 재 보자.

```cpp title="sizes.cpp"
#include <iostream>

int main() {
    std::cout << "char        " << sizeof(char) << "\n";
    std::cout << "short       " << sizeof(short) << "\n";
    std::cout << "int         " << sizeof(int) << "\n";
    std::cout << "long        " << sizeof(long) << "\n";
    std::cout << "long long   " << sizeof(long long) << "\n";
    std::cout << "float       " << sizeof(float) << "\n";
    std::cout << "double      " << sizeof(double) << "\n";
    std::cout << "long double " << sizeof(long double) << "\n";
    std::cout << "bool        " << sizeof(bool) << "\n";
    std::cout << "void*       " << sizeof(void*) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sizes.cpp -o sizes
$ ./sizes
char        1
short       2
int         4
long        8
long long   8
float       4
double      8
long double 16
bool        1
void*       8
```

(g++ 13 / Linux x86-64 실측. 이 배치를 **LP64**라 부른다 — long과 pointer가 64비트.) 같은 64비트라도 Windows(LLP64)에서는 `long`이 4바이트다. `long`이 8바이트라고 가정한 코드는 Windows로 가져가는 순간 깨진다.

::: hist 왜 크기를 못 박지 않았나
C가 태어난 시절의 하드웨어는 워드 크기가 제각각이었다 — 16비트 PDP-11, 36비트 Honeywell, 60비트 CDC. "int는 그 머신에서 가장 자연스러운 크기"로 두는 것이 모든 머신에서 빠른 코드를 얻는 유일한 방법이었다. C++은 C 코드와 ABI를 그대로 물려받아야 했으므로 이 결정도 물려받았다. 이식성을 위한 유연함이었던 것이 지금은 이식성을 해치는 모호함이 됐고, 그 구멍을 메우려고 나온 것이 다음의 고정폭 정수다.
:::

### 로봇 코드는 고정폭 정수를 쓴다

`<cstdint>` 헤더는 크기가 이름에 박힌 타입을 준다: `int8_t`, `int16_t`, `int32_t`, `int64_t`와 부호 없는 짝 `uint8_t`~`uint64_t`. 이 책의 로봇 코드는 정수 폭이 의미를 갖는 자리에서 전부 이것을 쓴다. 이유는 명확하다.

- **하드웨어 레지스터**: 모터 드라이버의 duty 레지스터가 8비트라는 것은 데이터시트에 적힌 계약이다. `uint8_t`는 그 계약을 타입에 새긴다.
- **통신 프로토콜**: CAN 프레임, 시리얼 패킷의 필드는 비트 단위로 정의된다. "int였는데 이 보드에서는 크기가 달랐다"는 프로토콜 코드에서 용납이 안 된다.
- **메시지 직렬화**: ROS 2 메시지의 `int32`, `uint8` 필드는 어느 머신에서든 같은 폭이어야 노드 간 통신이 성립한다.

::: tip uint8_t를 cout으로 찍으면 문자가 나온다
`uint8_t`는 대부분의 구현에서 `unsigned char`의 별명(alias)이다. 그래서 스트림에 넣으면 숫자가 아니라 **문자로** 출력된다. 실측: `std::uint8_t id = 65;`를 `std::cout << id`로 찍으면 `65`가 아니라 `A`가 나온다. 숫자로 보고 싶으면 `static_cast<int>(id)`를 거쳐라. 센서 ID를 로그에 찍었는데 이상한 문자가 나온다면 십중팔구 이것이다.
:::

`int` 자체를 버리라는 말은 아니다. 루프 카운터나 일반 산술처럼 폭이 계약이 아닌 자리에는 `int`가 관례이고, 이 책도 그렇게 쓴다. 원칙은 하나다 — **폭이 의미를 가지면 고정폭, 아니면 int.**

## 부호의 지뢰밭

정수의 진짜 함정은 크기가 아니라 부호다. 셋을 차례로 밟아 본다. 전부 실측이다.

### unsigned는 0 아래로 감긴다

부호 없는 정수의 산술은 표준이 **모듈로 $2^N$** 으로 정의한다. 0에서 1을 빼면 에러가 아니라 그 타입의 최대값으로 감긴다(wrap-around).

```cpp title="under.cpp"
#include <cstdint>
#include <iostream>

int main() {
    unsigned int u = 0;
    u = u - 1;                       // 언더플로
    std::cout << "u          = " << u << "\n";

    std::uint8_t pwm = 250;
    pwm = pwm + 10;                  // 8비트로 감긴다
    std::cout << "pwm        = " << static_cast<int>(pwm) << "\n";

    std::size_t n = 0;
    std::cout << "n - 1      = " << n - 1 << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra under.cpp -o under
$ ./under
u          = 4294967295
pwm        = 4
n          = 18446744073709551615
```

세 줄 모두 버그의 씨앗이다. `u`는 32비트 최대값이 됐고, 250이던 `pwm`은 10을 더했더니 4가 됐다 — 출력 98%로 돌던 모터가 다음 주기에 2%로 꺼지는 코드다. 마지막 줄이 가장 악질이다. `size()`가 돌려주는 `std::size_t`는 부호가 없으므로, 빈 컨테이너에서 `size() - 1`은 -1이 아니라 18경이다. [0.3](#/first-build)에서 경고로 만났던 역순 루프 사고가 바로 이 성질에서 나온다.

### 부호가 다르면 비교도 거짓말한다

signed와 unsigned가 한 식에서 만나면 C++은 **signed 쪽을 unsigned로 변환**한다. 그 결과:

```cpp title="cmp.cpp — 조각: 핵심 두 줄만"
int s = -1;
unsigned int u = 1;
std::cout << (s < u);                        // false 가 나온다
std::cout << static_cast<unsigned int>(s);   // 4294967295
```

```console
$ ./cmp
-1 < 1u ?  false
(unsigned)-1 = 4294967295
```

-1이 1보다 작지 않다. 비교 직전에 -1이 4294967295로 변환됐기 때문이다. `-Wall -Wextra`는 이것을 `-Wsign-compare` 경고로 잡아 준다 — [0.3](#/first-build)에서 "경고 0개"를 기준으로 삼은 이유가 하나 더 늘었다.

### 정수 승격: uint8_t 둘을 더하면 int가 된다

더 이상한 규칙이 남았다. `int`보다 작은 정수 타입은 산술 연산에 들어가는 순간 **int로 승격(integer promotion)** 된다. `uint8_t` 두 개를 더한 결과의 타입이 무엇인지 직접 물어보자.

```cpp title="promo.cpp"
#include <cstdint>
#include <iostream>
#include <type_traits>

int main() {
    std::uint8_t a = 200;
    std::uint8_t b = 100;

    auto sum = a + b;   // 타입이 뭘까?

    std::cout << "sizeof(a)      = " << sizeof(a) << "\n";
    std::cout << "sizeof(a + b)  = " << sizeof(a + b) << "\n";
    std::cout << "sum            = " << sum << "\n";
    std::cout << std::boolalpha
              << "int?           = " << std::is_same_v<decltype(a + b), int> << "\n";

    std::uint8_t truncated = a + b;   // 다시 8비트에 넣으면
    std::cout << "truncated      = " << static_cast<int>(truncated) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra promo.cpp -o promo
$ ./promo
sizeof(a)      = 1
sizeof(a + b)  = 4
sum            = 300
int?           = true
truncated      = 44
```

1바이트 둘을 더했는데 결과는 4바이트 `int`이고, 값은 8비트에 안 들어가는 300이다. 승격 덕분에 중간 계산은 안전했지만, 그 300을 다시 `uint8_t`에 넣는 순간 44로 잘린다(300 − 256). 승격은 1970년대 하드웨어의 유산이다 — 당시 CPU는 워드(int) 단위 연산만 있었고, C는 그 사실을 언어 규칙으로 만들었다. 오늘의 우리에게 남은 것은 "8비트 + 8비트의 타입은 int"라는 반직관이다.

::: warn -Wconversion도 봐주는 경우가 있다
이 절단을 잡는 플래그가 `-Wconversion`이다. 그런데 실측해 보면 구멍이 있다 — `pwm = pwm + 10;`처럼 **연산자 양쪽이 목적지와 같은 타입이면** g++ 13은 `-Wconversion`을 켜도 침묵한다(의도된 모듈로 산술로 간주한다). 반면 `std::uint8_t pwm = duty;`(duty는 `int` 변수)는 정확히 잡는다:

```console
$ g++ -std=c++20 -Wall -Wextra -Wconversion -c conv.cpp
conv.cpp:7:24: warning: conversion from 'int' to 'uint8_t' {aka 'unsigned char'} may change value [-Wconversion]
conv.cpp:9:15: warning: conversion from 'double' to 'float' may change value [-Wfloat-conversion]
conv.cpp:11:13: warning: conversion from 'long int' to 'int' may change value [-Wconversion]
```

`-Wconversion`은 좁히는 변환의 상당수를 잡아 주는 좋은 그물이지만, 전부는 아니다. 그물을 믿되 그물만 믿지는 마라.
:::

### signed 오버플로는 UB다 — 미정의 동작 첫 만남

unsigned의 랩어라운드는 표준이 **정의한** 동작이다. 반면 signed 정수의 오버플로는 **미정의 동작(undefined behavior, UB)** 이다 — 표준이 "이 경우 프로그램의 동작에 아무 요구도 하지 않는다"고 선언한 영역. 크래시할 수도, 이상한 값이 나올 수도, 겉보기에 멀쩡할 수도 있고, 컴파일러는 그 코드가 실행되지 않는다고 가정하고 최적화할 권리를 갖는다.

말로만 들으면 과장 같으니 실측한다. `INT_MAX`에 1을 더하고, 그 결과를 두 방식으로 관찰한다.

```cpp title="sover.cpp"
#include <climits>
#include <cstdio>

int main() {
    int x = INT_MAX;
    std::printf("x         = %d\n", x);
    std::printf("x + 1     = %d\n", x + 1);            // signed overflow: UB
    std::printf("x + 1 > x = %s\n", (x + 1 > x) ? "true" : "false");

    unsigned int u = UINT_MAX;
    std::printf("u + 1     = %u\n", u + 1);            // unsigned wrap: 정의된 동작
    return 0;
}
```

```console
$ g++ -std=c++20 sover.cpp -o sover
$ ./sover
x         = 2147483647
x + 1     = -2147483648
x + 1 > x = true
u + 1     = 0
```

**같은 실행 안에서 모순이 나왔다.** `x + 1`을 출력하면 -2147483648 — x보다 명백히 작은 값이다. 그런데 바로 다음 줄의 `x + 1 > x`는 true다. 컴파일러가 "signed 오버플로는 일어나지 않는다"는 가정 하에 `x + 1 > x`를 컴파일 타임에 참으로 접어 버렸기 때문이다. g++ 13에서는 `-O0`과 `-O2` 모두 이렇게 나왔다. 그리고 이것이 UB 서술의 핵심이다 — **이 환경에서는 이렇게 나왔지만, 아무 보장이 없다.** 컴파일러 버전 하나, 플래그 하나에 결과가 달라져도 컴파일러는 잘못이 없다. 계약을 어긴 것은 코드다.

UBSan(`-fsanitize=undefined`)을 붙이면 런타임에 정확히 짚어 준다.

```console
$ g++ -std=c++20 -fsanitize=undefined sover.cpp -o sover_ub
$ ./sover_ub
sover.cpp:7:16: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
```

UB는 이 책 전체를 관통하는 개념이다. 댕글링 포인터, 배열 범위 밖 접근, 데이터 레이스 — 전부 UB이고, [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 정면으로 다룬다. 지금 기억할 것은 하나다. **UB는 "이상한 값이 나오는 것"이 아니라 "프로그램 전체의 의미가 사라지는 것"이다.**

::: deep 표현은 정해졌는데 연산은 UB다
C++20부터 signed 정수의 표현은 2의 보수로 **못 박혔다**(그 전에는 표현조차 구현 정의였다). 그런데 오버플로는 여전히 UB로 남겼다. 모순 같지만 이유가 있다 — 오버플로를 UB로 두면 컴파일러가 `x + 1 > x` 같은 식을 접고, 루프 카운터의 범위를 증명해서 벡터화하는 등의 최적화를 할 수 있다. 표현의 보장은 이식성 문제였고, 연산의 UB는 성능 자산이라 위원회가 따로 취급했다.
:::

::: interview signed 오버플로 vs unsigned 오버플로
"signed와 unsigned 정수의 오버플로 동작 차이를 설명하라"는 C++ 면접의 고전이다. 답변 뼈대: ① unsigned는 표준이 모듈로 $2^N$ 랩어라운드로 **정의**한다 — 해시, 체크섬, 비트 조작에 유용하다. ② signed는 **UB**다 — 컴파일러는 오버플로가 없다고 가정하고 `x + 1 > x`를 상수 참으로 접거나 루프를 공격적으로 최적화한다. ③ 그래서 일반 산술에는 signed(`int`)를 쓰고, 오버플로 가능성은 연산 **전에** 범위 검사로 막으며, 탐지는 UBSan이나 `-ftrapv`로 한다. ④ "unsigned는 음수가 안 되니 안전하다"는 역발상 오답이다 — 랩어라운드는 진단 불가능한 **합법** 버그를 만든다. C++20의 2의 보수 보장(표현)과 오버플로 UB(연산)를 구분해 말하면 상급이다.
:::

## 부동소수점: double은 0.1을 저장하지 못한다

정수를 지났으니 실수다. 첫 실측부터 상식을 깬다.

```cpp title="fp.cpp"
#include <cstdio>

int main() {
    double a = 0.1;
    double b = 0.2;
    double sum = a + b;

    std::printf("0.1 + 0.2 == 0.3 ? %s\n", (sum == 0.3) ? "true" : "false");
    std::printf("0.1       = %.17g\n", a);
    std::printf("0.2       = %.17g\n", b);
    std::printf("0.1 + 0.2 = %.17g\n", sum);
    std::printf("0.3       = %.17g\n", 0.3);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra fp.cpp -o fp
$ ./fp
0.1 + 0.2 == 0.3 ? false
0.1       = 0.10000000000000001
0.2       = 0.20000000000000001
0.1 + 0.2 = 0.30000000000000004
0.3       = 0.29999999999999999
```

`0.1 + 0.2`는 `0.3`이 아니다. `%.17g`(double을 구분하는 데 필요한 최대 자릿수)로 찍어 보면 이유가 드러난다 — 애초에 0.1도 0.2도 0.3도 double에 **정확히 저장된 적이 없다.** double은 IEEE 754 배정밀도, 즉 이진 분수($1/2 + 1/4 + 1/8 + \cdots$)의 유한 합이다. 0.1은 이진법으로 무한소수라서(십진법의 1/3처럼), 가장 가까운 표현 가능한 값으로 반올림돼 저장된다. 그 반올림 오차가 연산마다 조금씩 다르게 쌓여서 `==`가 깨진다.

그래서 규칙이 나온다. **부동소수점에 `==`를 쓰지 마라.** 두 값이 "충분히 가까운가"를 허용 오차(epsilon)와 비교하는 것이 올바른 방법이고, 그 허용 오차를 어떻게 정하는지는 생각보다 깊은 문제라 [9.8 수치 안정성과 부동소수점 함정](#/numerics)에서 제대로 다룬다.

### float와 double: 자릿수의 차이를 실측한다

`<limits>`로 물어보면(아래 절에서 전체 실측) float는 십진 **6자리**, double은 **15자리**를 보장한다(`digits10`). 6자리가 얼마나 부족한지 로봇의 시간 누적으로 실험한다. 1 kHz 제어 루프가 주기마다 0.001초를 더해 경과 시간을 추적한다고 하자. 1시간이면 360만 번이다.

```cpp title="acc.cpp — 1 kHz 루프의 1시간"
#include <cstdio>

int main() {
    float  tf = 0.0f;
    double td = 0.0;
    for (int i = 0; i < 3'600'000; ++i) {
        tf += 0.001f;
        td += 0.001;
    }
    std::printf("float  1h = %.9g s\n", tf);
    std::printf("double 1h = %.9g s\n", td);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 acc.cpp -o acc
$ ./acc
float  1h = 3530.2041 s
double 1h = 3600 s
```

float 시계는 한 시간에 **약 70초를 잃었다.** 값이 커질수록 float의 표현 간격이 벌어져서, 큰 누적값에 작은 증분을 더할 때마다 증분의 일부가 반올림으로 증발하기 때문이다. double도 무오류는 아니다 — `%.17g`로 찍으면 3600.0000002746669, 오차가 있긴 하지만 0.3마이크로초 수준이다. 각도도 마찬가지다. $\pi/2$를 저장해 보면 float는 1.57079637051, double은 1.57079632679(소수 12자리 실측) — float의 오차는 라디안으로 약 $4 \times 10^{-8}$, 1 m 팔 끝에서 수십 나노미터라 당장은 무해해 보이지만, 이런 오차는 변환 행렬을 곱할 때마다 증폭된다.

그래서 로봇 소프트웨어의 관례는 명확하다. **좌표, 각도, 시간은 double을 쓴다.** float가 등장하는 곳은 메모리 대역폭이 지배하는 대량 데이터 — 포인트클라우드, 이미지, 신경망 가중치 — 뿐이다.

::: note ROS 2 메시지의 float64는 double이다
ROS 2 메시지 정의(IDL)의 숫자 타입은 C++ 타입으로 1:1 매핑된다: `float64` → `double`, `float32` → `float`, `int32` → `int32_t`, `uint8` → `uint8_t`. 로봇의 자세를 나르는 `geometry_msgs/msg/Pose`, 속도 명령 `Twist`의 필드가 전부 `float64`인 것은 위 관례가 메시지 표준에 새겨진 결과다. 반대로 `sensor_msgs/msg/PointCloud2`의 좌표는 관례상 `float32`다 — 포인트 수십만 개에는 정밀도보다 대역폭이 비싸다. 네가 메시지를 설계할 때도 같은 기준을 적용하면 된다.
:::

## 문자와 bool

### char는 세 타입이다

C++에는 `char`, `signed char`, `unsigned char`가 **서로 다른 세 타입**으로 존재한다. `char`가 둘 중 하나의 별명인 것이 아니다. 실측으로 확인한다.

```cpp title="chars.cpp — 조각: 판정 부분만"
std::cout << std::is_same_v<char, signed char>;     // false
std::cout << std::is_same_v<char, unsigned char>;   // false

char c = static_cast<char>(0xFF);
std::cout << static_cast<int>(c);                   // 이 환경에서 -1
```

```console
$ ./chars
char == signed char ?   false
char == unsigned char ? false
(int)c = -1
```

세 타입인데, 정작 `char`의 **부호는 구현 정의**다. 이 환경(x86-64 Linux)에서 char는 signed라서 비트 패턴 0xFF가 -1로 읽혔다. 그런데 ARM Linux의 ABI는 char를 unsigned로 정한다 — 같은 코드가 Jetson이나 라즈베리파이에서는 255를 낸다. 개발 PC(x86)에서 통과한 바이트 파싱 코드가 로봇의 ARM 보드에서 다르게 동작하는 고전적 이식성 사고다. 원칙: **문자는 char, 바이트·숫자는 uint8_t/int8_t.** char로 산술을 하지 마라.

문자 리터럴 `'A'`의 타입은 C++에서 `char`다(C에서는 int — 두 언어가 다른 드문 지점). 값은 문자 인코딩의 코드 값이고, 실측하면 `'A'` = 65, `'0'` = 48이다. 숫자 문자에서 `'7' - '0'` = 7이 나오는 것은 십진 숫자들이 연속 배치된다는 보장 덕분이다. 문자열은 [1.7 배열과 문자열](#/arrays-strings)의 몫이다.

### bool: 아무거나 bool이 된다

`bool`은 `true`/`false` 둘뿐인 타입이고 실측 크기는 1바이트다. 문제는 bool 자체가 아니라 **bool로의 암묵 변환**이다. 모든 산술 타입과 포인터가 조용히 bool로 변환된다(0이 아니면 true). 이것이 오버로드 해석과 만나면 사고가 난다.

```cpp title="booltrap.cpp"
#include <iostream>
#include <string>

void set_mode(bool autonomous) {
    std::cout << "bool 버전: " << std::boolalpha << autonomous << "\n";
}

void set_mode(const std::string& mode_name) {
    std::cout << "string 버전: " << mode_name << "\n";
}

int main() {
    set_mode("manual");   // 어느 쪽이 불릴까?
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra booltrap.cpp -o booltrap
$ ./booltrap
bool 버전: true
```

`"manual"`을 넘겼는데 **bool 버전이 true로** 불렸다. 경고도 없다. 문자열 리터럴의 타입은 `const char*`(포인터)이고, 포인터 → bool은 언어에 내장된 표준 변환인 반면 `const char*` → `std::string`은 사용자 정의 변환이다. 오버로드 해석은 표준 변환을 항상 우선한다 — 규칙의 전모는 [1.6 함수: 오버로딩과 인자 전달](#/functions)에서 다룬다. "모드 이름을 넘겼는데 자율주행이 켜졌다"는 코드를 만들고 싶지 않다면, bool 파라미터와 포인터/문자열 파라미터를 한 오버로드 집합에 섞지 마라.

## 리터럴에도 타입이 있다

`42`와 `42u`는 값은 같지만 타입이 다르다. 리터럴의 타입은 접미사가 정하고, `auto`는 그 타입을 그대로 받아 적는다. 실측:

```cpp title="lit.cpp — 조각: 선언부"
auto a = 42;          // int
auto b = 42u;         // unsigned int
auto c = 42L;         // long
auto d = 3.14;        // double  <- 접미사 없는 실수는 double
auto e = 3.14f;       // float
auto f = 0xFF;        // 16진, int
auto g = 0b1011;      // 2진 (C++14), int
auto h = 1'000'000;   // 자릿수 구분자 (C++14)
```

```console
$ ./lit
a: int?      true
b: unsigned? true
c: long?     true
d: double?   true
e: float?    true
f = 255, g = 11, h = 1000000
```

기억할 것 세 가지. 첫째, **접미사 없는 실수 리터럴은 float가 아니라 double**이다. `float gain = 0.5;`는 double 리터럴을 float로 좁히는 문장이고, `-Wconversion` 하에서는 위에서 본 `-Wfloat-conversion` 경고 대상이 된다 — float 변수에는 `0.5f`를 써라. 둘째, `0b` 이진 리터럴은 레지스터 비트마스크에 제격이다. 데이터시트가 "비트 3은 방향, 비트 0~2는 모드"라고 말하면 `0b0000'1000`이 16진보다 그대로 읽힌다(자릿수 구분자 `'`는 어디에나 끼울 수 있다). 셋째, `auto`는 리터럴의 타입을 그대로 물려받으므로 `auto t = 42u;`처럼 접미사가 곧 변수 타입 선언이 된다 — auto의 추론 규칙 전체는 [4.7 auto, decltype, 타입 추론 규칙](#/type-deduction)에서 해부한다.

## sizeof와 &lt;limits&gt;: 타입의 명세서를 읽는다

타입의 한계를 코드로 물어보는 창구가 `<limits>`의 `std::numeric_limits`다. 이 환경의 실측:

```console
$ ./lim
int   min      = -2147483648
int   max      = 2147483647
uint  max      = 4294967295
int64 max      = 9223372036854775807
float digits10 = 6
double digits10= 15
float  eps     = 1.19209e-07
double eps     = 2.22045e-16
double max     = 1.79769e+308
char signed?   = true
```

`epsilon()`은 "1.0과 그다음 표현 가능한 수의 간격" — 머신 엡실론이다. 부동소수점 비교의 허용 오차를 정할 때 출발점이 되는 값이고, [9.8](#/numerics)에서 다시 만난다. `digits10`은 위에서 예고한 십진 보장 자릿수다. 매직 넘버 `2147483647`을 코드에 박는 대신 `std::numeric_limits<int>::max()`를 쓰면 의도가 타입과 함께 움직인다.

마지막으로 `sizeof`의 성질 하나. `sizeof`는 **컴파일 타임 연산자**다 — 피연산자의 타입만 보고, 식을 실행하지 않는다.

```cpp title="조각: sizeof는 평가하지 않는다"
int i = 0;
std::size_t s = sizeof(++i);   // ++i 는 실행되지 않는다
```

```console
sizeof(++i) = 4, i = 0
```

`++i`를 넣었는데 `i`는 0 그대로다. 컴파일러는 `++i`의 타입(int)만 보고 4를 상수로 박아 넣었다. 그래서 `sizeof`는 실행 비용이 0이고, 배열 크기나 `static_assert` 조건처럼 컴파일 타임 문맥에 쓸 수 있다. 구조체에 `sizeof`를 대면 멤버 합보다 큰 수가 나오곤 하는데, 그 패딩 이야기는 [2.12 객체 메모리 레이아웃과 정렬](#/object-layout)의 주제다.

## 요약

- 표준은 `int`의 크기를 정하지 않았다. x86-64 Linux(LP64) 실측: int 4, long 8, 포인터 8바이트 — Windows는 long이 4다. **폭이 계약이면 고정폭(`int32_t`, `uint8_t`), 아니면 int.**
- unsigned 산술은 모듈로 $2^N$으로 **정의된** 랩어라운드다: `0u - 1` = 4294967295. signed 오버플로는 **UB**다 — 컴파일러는 없다고 가정하고 최적화하며, 같은 실행에서 `x + 1`이 음수로 찍히면서 `x + 1 > x`가 true인 모순도 합법이다.
- `int`보다 작은 타입은 산술 전에 int로 **승격**된다: `uint8_t + uint8_t`의 타입은 int(실측 300), 도로 uint8_t에 넣으면 잘린다(실측 44). 좁히는 대입은 `-Wconversion`으로 잡되, 같은 타입끼리의 연산 결과는 봐준다는 구멍을 기억하라.
- double은 0.1을 정확히 저장하지 못한다(`0.1 + 0.2 != 0.3` 실측). 부동소수점에 `==` 금지, 비교는 epsilon으로 — [9.8](#/numerics).
- float는 십진 6자리, double은 15자리. 1 kHz 시간 누적 실측에서 float는 1시간에 70초를 잃었다. **좌표·각도·시간은 double** — ROS 2 메시지의 `float64`가 곧 double이다.
- `char`/`signed char`/`unsigned char`는 별개의 세 타입이고 char의 부호는 구현 정의다(x86 signed, ARM unsigned). 문자는 char, 바이트는 uint8_t.
- 포인터·산술 타입은 조용히 bool이 된다 — 문자열 리터럴이 `std::string` 오버로드 대신 bool 오버로드로 가는 함정을 실측했다.
- 리터럴 접미사가 타입이다: `42u`, `3.14f`, `0b1011`, `1'000'000`. 접미사 없는 실수는 double이다.

::: quiz 연습문제
1번은 예측 문제, 2번과 3번은 개념 문제, 4번과 5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. 다음 코드의 출력을 **컴파일하지 말고** 예측하라. 그다음 근거를 한 문장으로 써라.

   ```cpp
   std::uint8_t a = 30;
   std::uint8_t b = 50;
   std::cout << (a - b < 0);
   ```

2. `unsigned` 오버플로는 합법인데 `signed` 오버플로는 UB다. 이 비대칭이 컴파일러 최적화에 주는 이득 하나와, 코드 작성자가 대신 짊어지는 부담 하나를 말하라.

3. 관절 각도를 `float`로 저장하자는 동료의 제안을 들었다. 반대하는 근거를 이 절의 실측 두 가지로 대라. float가 오히려 옳은 데이터는 무엇인가?

4. (실습) 정수 승격 확인: `uint8_t` 값 200과 100을 더해 ① `auto` 변수에 받았을 때 ② `uint8_t` 변수에 받았을 때의 값을 각각 예측한 뒤, `promo.cpp`를 직접 쳐서 확인하라. 성공 기준: 예측과 실행 결과가 일치하고, `decltype` 판정이 `int`로 나온다.

5. (실습) `-Wconversion` 경고 재현: `int` 변수를 `uint8_t`에 대입하는 코드를 쓰고, `g++ -std=c++20 -Wall -Wextra -Wconversion -c` 로 컴파일해 `may change value` 경고를 재현하라. 그다음 같은 파일에서 `uint8_t pwm = 250; pwm = pwm + 10;`을 추가하고 경고가 **안 나오는 것**을 확인하라. 성공 기준: 경고가 정확히 첫 번째 대입에서만 난다.
:::

::: answer 해설
1. 출력은 `0`(false)이다. `a - b`에서 두 피연산자는 **int로 승격**되므로 결과는 uint8_t 언더플로가 아니라 int −20이다… 라고 생각했다면 절반만 맞다 — −20 < 0은 true이므로 출력은 1이 맞지 않나? 아니다, 함정은 없다: 승격 덕분에 `a - b`는 정말 int −20이고, 출력은 `1`(true)이다. 이 문제의 교훈은 예측 과정 그 자체다 — **uint8_t끼리의 뺄셈은 승격 때문에 음수가 될 수 있다.** 만약 `a - b`를 `std::size_t`나 `unsigned`끼리로 바꾸면 그때는 거대한 양수가 되어 0이 나온다. 직접 두 버전을 컴파일해 비교해 보라.
2. 이득: 오버플로가 없다고 가정하면 `x + 1 > x`를 상수 true로 접거나, 루프 카운터의 상한을 증명해 벡터화하는 최적화가 가능하다(이 절에서 −O0에서도 접히는 것을 실측했다). 부담: 오버플로 가능성을 **연산 전에** 범위 검사로 막는 책임이 코드 작성자에게 넘어온다. 사후 검사(`if (x + 1 < x)`)는 이미 UB를 밟은 뒤라 무의미하다 — 검사 자체가 최적화로 사라질 수 있다.
3. 실측 근거 ① 1 kHz 누적 실험에서 float는 1시간에 약 70초를 잃었다 — 시간·적분 누적에 float는 부적격이다. ② $\pi/2$ 저장 실측에서 float의 오차는 소수 7자리부터 나타났고, 이 오차는 변환 행렬 곱셈마다 증폭된다. float가 옳은 데이터: 포인트클라우드·이미지처럼 원소 수가 수십만 개라 정밀도보다 메모리 대역폭이 비싼 대량 데이터(`PointCloud2`의 좌표가 float32인 이유).
4. 실측 기준값: ① `auto sum = a + b;`는 int 300. ② `uint8_t truncated = a + b;`는 44(= 300 − 256). `std::is_same_v<decltype(a + b), int>`가 true다. 본문 `promo.cpp`와 같은 결과가 나와야 한다.
5. g++ 13 실측으로 `conversion from 'int' to 'uint8_t' {aka 'unsigned char'} may change value [-Wconversion]`이 int → uint8_t 대입에서만 난다. `pwm = pwm + 10;`이 조용한 이유: 연산자 양쪽이 목적지와 같은 타입이면 g++는 의도된 모듈로 산술로 간주한다. 그물의 구멍을 눈으로 확인하는 것이 이 실습의 목적이다.
:::

이 절의 코드는 전부 짧다. 전부 직접 쳐라. 특히 `motor.cpp`, `promo.cpp`, `sover.cpp`, `fp.cpp` 네 개는 예측 → 실행 → 비교의 리듬으로 돌리고, `sover.cpp`는 UBSan 버전까지 확인하라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -Wconversion main.cpp -o main && ./main`, UBSan은 `g++ -std=c++20 -fsanitize=undefined main.cpp && ./a.out`이다.

**다음 절**: [1.3 변수, 초기화, 스코프](#/variables) — 타입을 알았으니 그 타입의 변수가 태어나는 방식이다. C++ 초기화 문법이 왜 지뢰밭인지, `int x = 3.7;`이 왜 조용히 3이 되는지부터 연다.
