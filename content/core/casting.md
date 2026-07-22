# 1.4 캐스팅과 타입 변환

::: lead
[1.2](#/types)의 motor.cpp를 기억하라 — 후진 100 명령이 전진 156이 됐다. 그 코드에는 캐스트가 한 글자도 없었다. 값을 바꾼 것은 당신이 아니라 컴파일러다. 이것이 **암묵 변환(implicit conversion)** 이고, C++에는 이런 변환이 언어 곳곳에 깔려 있다. 이 절은 먼저 컴파일러가 허락 없이 하는 변환의 전체 지도를 그리고, 그다음 당신이 **명시적으로** 지시하는 네 가지 캐스트 — `static_cast`, `const_cast`, `reinterpret_cast`, `dynamic_cast` — 를 하나씩 해부한다. 그리고 C 시절의 `(int)x` 문법을 이 책이 왜 금지하는지, 실측 두 방으로 증명한다.
:::

## 컴파일러가 허락 없이 하는 변환의 지도

[1.2](#/types)에서 지뢰를 하나씩 밟았다면, 이제 지뢰밭 전체의 지도를 그린다. 캐스트를 배우기 전에 이 지도가 먼저인 이유는 하나다 — **명시적 캐스트는 암묵 변환이 이미 벌어지고 있다는 사실을 아는 사람만 쓸 수 있다.** 암묵 변환의 종류는 크게 넷이다.

**① 정수 승격(integer promotion).** `int`보다 작은 타입은 산술에 들어가는 순간 int가 된다. `uint8_t + uint8_t`의 타입이 int라는 것을 [1.2](#/types)에서 실측했다(200 + 100 = 300, 도로 uint8_t에 넣으면 44).

**② 통상 산술 변환(usual arithmetic conversions).** 이항 연산자의 양쪽 타입이 다르면 컴파일러가 한쪽을 다른 쪽으로 맞춘다. 규칙의 방향은 "정보를 덜 잃는 쪽"이다 — int와 double이 만나면 int가 double이 되고, signed와 unsigned가 만나면 signed가 unsigned가 된다(-1 < 1u가 false였던 [1.2](#/types)의 실측이 바로 이것이다). 문제는 이 변환이 **연산자 단위로, 안쪽부터** 적용된다는 것이다.

```cpp title="implicit.cpp — double 식 안에 정수 나눗셈이 숨어 있다"
#include <iostream>

int main() {
    double celsius = 100.0;
    double fahrenheit = celsius * (9 / 5) + 32;   // 9/5 는 정수 나눗셈
    std::cout << "fahrenheit = " << fahrenheit << "\n";

    double ratio = 3 / 4;
    std::cout << "ratio      = " << ratio << "\n";

    int n = 7;
    double avg = n / 2;
    std::cout << "avg        = " << avg << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra implicit.cpp -o implicit
$ ./implicit
fahrenheit = 132
ratio      = 0
avg        = 3
```

물 끓는점이 화씨 132도가 됐다(정답은 212). `celsius`가 double이니 식 전체가 double로 계산될 것 같지만, `(9 / 5)`는 괄호 안에서 **int끼리** 먼저 만난다 — 정수 나눗셈으로 1이 되고, 그 1이 double로 승격돼 곱해진다. `ratio = 3 / 4`도 마찬가지로 0이다. 결과를 담는 변수가 double이라는 사실은 우변의 계산 과정에 아무 영향을 주지 않는다. 변환은 대입 시점이 아니라 **연산자마다** 일어난다.

**③ bool 변환.** 산술 타입과 포인터는 조건문 자리에서 조용히 bool이 된다(0이 아니면 true). [1.2](#/types)에서 문자열 리터럴이 bool 오버로드로 빨려 들어가는 것을 실측했다. 여기에 대입 연산자가 값을 돌려준다는 성질이 겹치면 고전적인 오타 함정이 완성된다.

```cpp title="boolconv.cpp — == 를 치려다 = 를 쳤다"
double gain = 0.5;
if (gain = 1.0) {   // 대입의 결과값 1.0 이 true 로 변환된다
    // 항상 실행된다. gain 은 이미 1.0 으로 덮였다
}
```

이 코드는 컴파일되고, 실행하면 조건이 항상 참이다(실측: `always here, gain = 1`). `-Wall`이 `suggest parentheses around assignment used as truth value [-Wparentheses]` 경고로 잡아 준다 — [0.3](#/first-build)의 "경고 0개" 원칙이 또 한 번 값을 한다.

**④ 배열 → 포인터 붕괴(decay).** 배열 이름은 대부분의 문맥에서 첫 원소의 포인터로 조용히 변환된다. `sizeof`가 배열에서는 전체 크기를, 함수 인자로 넘어간 뒤에는 포인터 크기 8을 내놓는 이유가 이것이다. 전모는 [1.7 배열과 문자열](#/arrays-strings)에서 다룬다 — 지금은 "배열도 암묵 변환의 대상"이라는 사실만 지도에 표시해 둔다.

이 지도의 공통점을 보라. **넷 다 문법상 아무 표시가 없다.** 코드를 읽는 사람은 변환이 일어나는 자리를 눈으로 찾을 수 없다. 그래서 C++은 "변환을 명시하고 싶을 때" 쓰는 도구를 준다 — 그런데 그 도구가 두 세대다. C에서 물려받은 구식 문법과, C++이 새로 설계한 네 가지 캐스트. 구식부터 처형한다.

## C 스타일 캐스트: (int)x 를 금지하는 두 가지 이유

`(타입)식` — C 캐스트 문법은 짧고 익숙하다. 이 책은 그것을 쓰지 않는다. 이유는 취향이 아니라 실측이다.

**이유 1: 검색이 안 된다.** 캐스트는 "여기서 타입을 강제로 비틀었다"는 위험 표지다. 코드 리뷰나 버그 사냥에서 캐스트 지점부터 뒤지는 일은 흔한데, `grep -rn "static_cast" src/`는 한 방이지만 C 캐스트는 잡을 패턴이 없다 — `(int)`는 함수 선언 `f(int)`, 함수 호출의 괄호와 구분되지 않는다. C++ 캐스트의 이름이 길고 못생긴 것은 **의도된 설계다**. 눈에 띄라고, 그리고 검색되라고 그렇게 만들었다.

**이유 2: 네 가지 의미 중 아무거나 조용히 골라잡는다.** C 캐스트 하나가 뒤에서 배울 캐스트 여러 개의 권한을 겸직한다. 어느 권한이 발동됐는지는 문맥이 정하고, 코드에는 드러나지 않는다. 실측으로 확인한다. const를 벗기는 코드다.

```cpp title="ccast.cpp — 같은 일, 두 문법" {3,4}
int main() {
    const int limit = 100;
    int* p = (int*)&limit;              // C 캐스트
    int* q = static_cast<int*>(&limit); // static_cast
    (void)p; (void)q;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c ccast.cpp
ccast.cpp: In function 'int main()':
ccast.cpp:4:14: error: invalid 'static_cast' from type 'const int*' to type 'int*'
    4 |     int* q = static_cast<int*>(&limit); // static_cast: 에러
      |              ^~~~~~~~~~~~~~~~~~~~~~~~~
```

`static_cast` 줄만 에러다. 3번 줄의 C 캐스트는 **경고 하나 없이** 통과했다(4번 줄을 지우고 컴파일하면 완전 침묵 — 실측). C 캐스트가 조용히 const_cast의 권한을 꺼내 쓴 것이다. 관련 없는 포인터 타입 사이도 마찬가지다.

```cpp title="조각 — C 캐스트는 reinterpret 권한도 겸직한다"
float f = 1.0f;
int* p = (int*)&f;               // 조용히 통과 (비트 재해석 의미)
int* q = static_cast<int*>(&f);  // error: invalid 'static_cast'
                                 //        from type 'float*' to type 'int*'
```

`(int*)&f`를 쓴 사람이 비트 재해석을 의도했는지, 타입을 잘못 알았는지 코드만 봐서는 알 수 없다. C++ 캐스트는 이 겸직을 해체해서 **권한 하나당 이름 하나**를 붙였다. 그래서 캐스트 이름 자체가 문서다 — `static_cast`는 "값 변환만, const와 비트에는 손 안 댐"이라는 선언이다.

::: deep C 캐스트가 시도하는 순서
표준은 C 캐스트를 "다음을 순서대로 시도해서 처음 되는 것"으로 정의한다: ① `const_cast`, ② `static_cast`, ③ `static_cast` + `const_cast`, ④ `reinterpret_cast`, ⑤ `reinterpret_cast` + `const_cast`. 즉 C 캐스트는 새로운 종류의 변환이 아니라 **C++ 캐스트들의 자동 선택기**다. 가장 위험한 ④⑤까지 자동으로 내려간다는 것이 문제의 핵심이다 — 오타로 타입을 잘못 쓰면 에러 대신 비트 재해석이 나간다. 유일하게 dynamic_cast의 권한만은 C 캐스트에 없다.
:::

## static_cast: 의미 있는 변환의 기본값

`static_cast<T>(x)`는 "타입 시스템이 의미를 아는 변환"을 명시적으로 수행한다. 산술 타입 사이, 관련 있는 포인터 사이(상속 계층 — Part III), 열거형과 정수 사이. 컴파일 타임에 변환의 타당성을 검사하고, 말이 안 되는 조합(위의 `float*` → `int*`)은 에러로 거부한다. 당신이 앞으로 쓰는 캐스트의 9할이 이것이어야 한다.

가장 흔한 용례가 double → int다. 이 변환의 규칙은 반올림이 아니라 **0 방향 절단(truncation toward zero)** 이다.

```cpp title="trunc.cpp — static_cast 는 반올림하지 않는다"
#include <cmath>
#include <iostream>

int main() {
    std::cout << "static_cast<int>(2.999) = " << static_cast<int>(2.999)  << "\n";
    std::cout << "static_cast<int>(-2.9)  = " << static_cast<int>(-2.9)   << "\n";
    std::cout << "std::lround(2.999)      = " << std::lround(2.999)       << "\n";
    std::cout << "std::lround(-2.9)       = " << std::lround(-2.9)        << "\n";

    double duty_ratio = 0.6349;                        // 제어기가 계산한 출력 비율
    int duty = static_cast<int>(duty_ratio * 255);     // 8비트 duty 로 변환
    std::cout << "duty (truncated)        = " << duty << "\n";
    std::cout << "duty_ratio * 255        = " << duty_ratio * 255 << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra trunc.cpp -o trunc
$ ./trunc
static_cast<int>(2.999) = 2
static_cast<int>(-2.9)  = -2
std::lround(2.999)      = 3
std::lround(-2.9)       = -3
duty (truncated)        = 161
duty_ratio * 255        = 161.9
```

2.999는 3이 아니라 2가 되고, -2.9는 -3이 아니라 -2가 된다 — 소수부를 그냥 버린다(그래서 음수에서는 "내림"도 아니다). 반올림을 원하면 `<cmath>`의 `std::lround`를 써라. 마지막 두 줄이 로봇 코드에서 이 차이가 실제로 문제되는 지점이다. 제어기가 계산한 duty 161.9를 절단하면 161 — 매 주기 최대 1 LSB를 항상 **한 방향으로** 잃는다. 무작위 오차는 평균에서 상쇄되지만 절단 오차는 편향(bias)이라 적분기에 쌓인다. 수치 오차가 제어에 미치는 영향은 [9.8 수치 안정성과 부동소수점 함정](#/numerics)의 주제다.

`static_cast`의 두 번째 역할은 이미 여러 번 봤다 — [1.2](#/types)의 `static_cast<int>(duty)`는 uint8_t가 문자로 출력되는 것을 막는 용도였고, [1.3](#/variables)에서 중괄호가 거부한 축소 변환을 "의도한 잘림"으로 통과시키는 것도 static_cast의 몫이다. 공통점은 하나다. **변환이 일어난다는 사실을 코드에 새겨서, 읽는 사람과 grep에게 보이게 만든다.**

## const_cast: 약속을 깨는 캐스트

`const_cast<T*>(p)`는 포인터·레퍼런스에서 const(와 volatile)를 벗기거나 붙인다. 벗기는 쪽이 문제다 — const는 "이 경로로는 수정하지 않는다"는 약속인데, 그 약속을 깨는 도구이기 때문이다.

정당한 용례는 사실상 하나, **레거시 API 경계**다. 읽기만 하면서도 시그니처에 const를 안 붙인 오래된 C 라이브러리는 지금도 많다. 모터 드라이버 벤더가 주는 SDK가 전형적이다.

```cpp title="legacy.cpp — 읽기만 하는데 시그니처가 non-const 인 C API"
#include <string>

extern "C" void legacy_send(char* buf, int len);   // 문서상 buf 를 수정하지 않는다

void send_name(const std::string& name) {
    legacy_send(const_cast<char*>(name.c_str()), static_cast<int>(name.size()));
}
```

이 코드가 합법인 조건을 정확히 하자. **const_cast로 벗기는 것 자체는 합법이다. UB는 그 포인터로 "원래 const인 객체"를 실제로 수정하는 순간 발생한다.** 위 코드는 `legacy_send`가 문서대로 읽기만 한다는 전제 위에서 안전하다 — 전제가 깨지면 UB다. 그러니 const_cast를 쓸 때마다 주석으로 그 전제를 남겨라.

"원래 const인 객체 수정"이 어떤 모습인지 실측한다.

```cpp title="constcast.cpp — 같은 주소, 다른 값"
#include <cstdio>

int main() {
    const int limit = 250;                 // 태생이 const 인 객체
    int* p = const_cast<int*>(&limit);
    *p = 999;                              // UB — 원래 const 객체를 수정

    std::printf("limit = %d\n", limit);
    std::printf("*p    = %d\n", *p);
    std::printf("addr  same? %s\n", (&limit == p) ? "yes" : "no");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra constcast.cpp -o constcast
$ ./constcast
limit = 250
*p    = 999
addr  same? yes
```

**같은 주소를 두 이름으로 읽었는데 값이 다르다.** 컴파일러는 `limit`이 const이므로 값이 250에서 영원히 변하지 않는다고 믿고, `limit`을 출력하는 자리에 250을 상수로 박아 넣었다. 메모리에는 999가 쓰였지만(`*p`가 증명한다) `limit`은 250으로 찍힌다. g++ 13에서는 `-O0`과 `-O2` 모두 이렇게 나왔다 — 그리고 [1.2](#/types)의 signed 오버플로에서 했던 말을 반복한다. **이 환경에서는 이렇게 나왔지만 아무 보장이 없다.** 크래시해도, 999가 두 번 나와도 컴파일러는 잘못이 없다. UB의 세계에서는 "같은 주소는 같은 값"이라는 상식조차 계약 위반자에게는 적용되지 않는다.

::: danger 함수에 들어온 const 는 벗겨도 되는가
"매개변수로 받은 `const T*`를 const_cast 하는 건 괜찮다"는 말을 흔히 듣는데, 절반만 맞다. 합법 여부는 **캐스트 지점이 아니라 원본 객체가 결정한다.** 호출자가 non-const 객체의 주소를 넘겼다면 벗겨서 수정해도 합법이고, const 객체를 넘겼다면 같은 코드가 UB다. 즉 const_cast가 있는 함수는 안전성이 자기 코드가 아니라 **모든 호출자**에 달려 있다 — 그래서 레거시 경계 밖에서는 쓰지 않는 것이다.
:::

## reinterpret_cast: 비트를 다시 읽는다

`reinterpret_cast<T*>(p)`는 변환을 하지 않는다. **같은 비트를 다른 타입의 안경으로 읽겠다**는 선언이고, 대부분의 경우 기계어 명령이 하나도 생성되지 않는다. 가장 강력하고, 그래서 정당한 용처가 가장 좁다.

교과서적인 정당 사례는 **하드웨어 레지스터 접근**이다. MCU 데이터시트가 "GPIO 출력 레지스터는 주소 0x40021014"라고 말하면, 그 정수를 포인터로 바꾸는 방법은 재해석뿐이다.

```cpp title="조각 — MCU 펌웨어의 레지스터 접근 (PC 에서는 실행 불가)"
auto* gpio_odr = reinterpret_cast<volatile std::uint32_t*>(0x40021014);
*gpio_odr |= (1u << 5);   // 5번 핀 HIGH
```

정수 리터럴 → 포인터는 타입 시스템 바깥의 사실(데이터시트)에 근거한 변환이라 컴파일러가 검증할 방법이 없고, 그래서 reinterpret_cast의 영역이다(`volatile`이 왜 붙는지는 [6.5 atomic과 메모리 오더](#/atomic)에서 다룬다). 이 코드는 해당 MCU에서만 의미가 있다 — PC에서 실행하면 그 주소에 레지스터가 없으니 크래시다.

문제는 두 번째 유혹이다. 로봇 코드는 센서가 보낸 **바이트 버퍼에서 값을 꺼내는 일**을 끝없이 한다. IMU가 시리얼로 5바이트 패킷(헤더 1 + float 4)을 보냈다고 하자. reinterpret_cast가 정확히 그 일을 해줄 것처럼 생겼다.

```cpp title="packet.cpp — 유혹과 정답" {9,10,14}
#include <cstdint>
#include <cstring>
#include <cstdio>

int main() {
    // IMU packet: [0] header 0xA5, [1..4] float roll (little-endian)
    alignas(4) std::uint8_t packet[5] = { 0xA5, 0x00, 0x00, 0xC8, 0x42 };

    const float* wrong = reinterpret_cast<const float*>(packet + 1);   // ❌
    std::printf("reinterpret = %g\n", *wrong);

    float roll = 0.0f;
    std::memcpy(&roll, packet + 1, sizeof(roll));                      // ✅
    std::printf("memcpy      = %g\n", roll);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 packet.cpp -o packet
$ ./packet
reinterpret = 100
memcpy      = 100
```

둘 다 100이 나왔다(바이트 `00 00 C8 42`는 리틀엔디언 float 100.0f다). 값이 같은데 왜 하나는 ❌인가. `*wrong`은 **두 개의 UB를 동시에** 밟고 있다.

첫째, **정렬(alignment) 위반.** float는 4바이트 정렬을 요구하는데 `packet + 1`은 홀수 주소다. x86은 비정렬 접근을 하드웨어가 봐주지만 그것은 이식성이 아니라 요행이다 — ARM 계열은 명령에 따라 버스 폴트를 낸다. 개발 PC에서 멀쩡하다가 로봇의 ARM 보드에서 죽는, [1.2](#/types)의 char 부호 문제와 같은 계열의 이식성 사고다. UBSan이 정확히 짚어 준다.

```console
$ g++ -std=c++20 -fsanitize=undefined packet.cpp -o packet_ub
$ ./packet_ub
packet.cpp:10:39: runtime error: load of misaligned address 0x7ffefa1cd7d1 for type 'const float', which requires 4 byte alignment
```

(주소값은 실행마다 다르다 — ASLR.) 둘째, **strict aliasing 위반.** 컴파일러는 "`uint8_t` 배열에 저장된 객체를 `float*`로 읽는 일은 없다"고 가정하고 최적화한다. 이 가정을 어긴 코드는 최적화 수준·컴파일러 버전에 따라 값이 달라질 수 있는 시한폭탄이다 — 왜 이 가정이 최적화에 필요한지는 [8.3 컴파일러 최적화와 코드 생성](#/codegen)에서, UB로서의 정체는 [2.11](#/ub-sanitizers)에서 다룬다.

정답은 `std::memcpy`다. "복사 함수를 부르면 느리지 않나"가 당연한 의심인데, 실측으로 답한다.

::: perf memcpy 는 공짜다
파싱 함수를 `-O2`로 컴파일하고 생성된 기계어를 봤다(g++ 13, x86-64 실측).

```cpp title="parse.cpp"
float parse_roll(const std::uint8_t* payload) {
    float roll;
    std::memcpy(&roll, payload, sizeof(roll));
    return roll;
}
```

```console
$ g++ -std=c++20 -O2 -c parse.cpp && objdump -d parse.o
0000000000000000 <_Z10parse_rollPKh>:
   0:  endbr64
   4:  movss  (%rdi),%xmm0
   8:  ret
```

함수 호출이 없다. `movss` — 메모리에서 float 레지스터로 읽는 **단 한 개의 명령**이다. 컴파일러는 크기가 상수인 memcpy를 load/store로 바꾸고, 비정렬 접근이 위험한 타깃에서는 그 타깃에 맞는 안전한 명령을 고른다. 즉 memcpy는 "복사 비용을 내는 것"이 아니라 **비트 재해석의 합법적 표기법**이다. C++20의 `std::bit_cast`는 이 관용구를 아예 표준 함수로 만든 것이다 — 크기가 같은 두 타입 사이의 재해석을 한 줄로, UB 없이 한다.
:::

정리하면 reinterpret_cast의 자리는 좁다. **정수 ↔ 포인터(하드웨어 주소), 바이트 버퍼의 포인터를 `char*`/`uint8_t*`로 보는 것** — 이 정도가 로봇 코드의 전부고, "버퍼에서 값 꺼내기"는 memcpy(또는 bit_cast)의 몫이다. ROS 2 미들웨어가 메시지를 네트워크 바이트로 바꾸는 직렬화 계층도 내부적으로 같은 규율로 구현된다 — [10.2 토픽: publisher와 subscription](#/pub-sub)에서 그 경계를 만난다.

## dynamic_cast: 예고만

네 번째 캐스트는 지금 다룰 수 없다. `dynamic_cast<Derived*>(base_ptr)`는 상속 계층에서 "이 base 포인터가 실제로는 Derived를 가리키는가"를 **런타임에** 검사하고, 아니면 nullptr를 돌려준다. 이 검사가 동작하려면 객체가 자기 타입 정보를 실행 중에 들고 다녀야 하고, 그 메커니즘(RTTI와 vtable)은 다형성 없이는 설명이 안 된다. 유일하게 런타임 비용이 있는 캐스트라는 사실만 기억해 두라 — [3.4 가상함수와 vtable](#/virtual-vtable)에서 그 비용의 실체를 실측한다.

## 좁히는 변환을 막는 그물 세 겹

절의 앞부분이 "컴파일러가 조용히 하는 변환"이었다면, 마지막은 그것을 **막는** 도구다. 그물은 세 겹이고, 각각 잡는 범위가 다르다.

**그물 1 — 중괄호 초기화.** [1.3](#/variables)에서 `int period_ms{3.14}`가 에러가 되는 것을 실측했다. 이번 절의 주인공으로 다시 실측하면 그물의 결이 보인다.

```cpp title="narrow.cpp — 같은 축소, 다른 진단" {5,6}
#include <cstdint>

int main() {
    int velocity_cmd = -100;
    std::uint8_t duty1 = velocity_cmd;    // = : 침묵 (1.2 의 사고)
    std::uint8_t duty2 { velocity_cmd };  // {} : 진단
    (void)duty1; (void)duty2;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c narrow.cpp
narrow.cpp:6:26: warning: narrowing conversion of 'velocity_cmd' from 'int' to 'uint8_t' {aka 'unsigned char'} [-Wnarrowing]
```

주의할 실측 결과가 하나 있다 — [1.3](#/variables)의 리터럴(`{3.14}`)은 **에러**였는데, 런타임 값인 변수를 넣으니 g++ 13은 **경고**만 낸다(표준상은 둘 다 부적격이지만 g++가 변수 쪽을 경고로 완화해 준다). 빌드를 확실히 멈추고 싶으면 `-Werror=narrowing`을 켜라. 어느 쪽이든 `=`의 완전한 침묵보다는 낫다.

**그물 2 — `-Wconversion`.** 중괄호는 초기화 지점만 지킨다. 이미 선언된 변수로의 대입, 함수 인자 전달에서의 축소는 [1.2](#/types)에서 실측한 `-Wconversion`이 잡는다 — 같은 타입끼리의 연산 결과는 봐준다는 구멍까지 포함해서, 그 절의 실측을 다시 보라.

**그물 3 — 검사하는 캐스트.** 앞의 두 그물은 "축소가 있다"는 사실만 알려 준다. 하지만 `static_cast<uint8_t>(velocity_cmd)`라고 명시하는 순간 경고는 꺼지고, 값이 실제로 들어가는지는 아무도 확인하지 않는다 — 명시적 캐스트는 "내가 책임진다"는 서명이기 때문이다. 그 책임을 코드로 지는 방법이 **검사 후 변환** 관용구다. C++ Core Guidelines 지원 라이브러리(GSL)의 `gsl::narrow`가 이 아이디어의 표준적 이름이다: 변환한 값을 원래 타입으로 되돌려서 원본과 비교하고, 다르면(값이 잘렸으면) 그 자리에서 실패를 알린다. 라이브러리를 안 쓰더라도 아이디어는 세 줄이다 — 변환하고, 되돌려 비교하고, 다르면 에러 처리. 하드웨어 레지스터에 쓰는 값처럼 잘리면 물리적 사고가 되는 경계에는 이 관용구를 두라. 어디서 에러를 내고 어떻게 전파하는지는 [5.9 optional, variant, expected](#/vocabulary-types)의 주제다.

::: interview 네 가지 캐스트의 차이를 설명하라
C++ 면접의 개근 문제다. 답변 뼈대: ① **static_cast** — 타입 시스템이 의미를 아는 변환(산술, 상속 계층 업/다운, enum↔정수). 컴파일 타임 검사, 런타임 비용 없음. 기본값. ② **const_cast** — const/volatile 자격만 조작. 벗기는 것은 합법, 원래 const 객체를 그 경로로 수정하면 UB. 레거시 API 경계 전용. ③ **reinterpret_cast** — 비트 재해석(정수↔포인터, 무관한 포인터 사이). 변환 명령이 생성되지 않는 대신 정렬·strict aliasing 책임이 전부 작성자에게 온다. 값 재해석은 memcpy/bit_cast가 정답. ④ **dynamic_cast** — 상속 계층의 다운캐스트를 RTTI로 **런타임 검사**, 실패 시 nullptr(포인터) 또는 예외(레퍼런스). 유일하게 런타임 비용이 있다. 마무리 한 방: "C 캐스트는 ①②③을 문맥에 따라 자동 선택하므로 의도가 코드에 남지 않고 grep도 안 된다 — 그래서 금지한다"까지 말하면 상급이다.
:::

## 요약

- 암묵 변환의 지도: 정수 승격, 통상 산술 변환, bool 변환, 배열→포인터 붕괴([1.7](#/arrays-strings) 예고). 전부 문법상 표시가 없다. `celsius * (9 / 5)`의 132°F 실측 — 변환은 대입이 아니라 **연산자마다** 일어난다.
- C 캐스트 `(int)x`는 금지: grep이 안 되고, 다섯 단계 자동 선택으로 const 벗기기·비트 재해석까지 조용히 내려간다. const 벗기기와 `float*`→`int*`가 C 캐스트로는 침묵, static_cast로는 에러임을 실측했다.
- **static_cast가 기본값이다.** double→int는 반올림이 아니라 0 방향 절단(실측: 2.999→2, -2.9→-2) — 반올림은 `std::lround`. 절단 오차는 편향이라 제어 루프에 쌓인다.
- const_cast의 정당한 자리는 레거시 API 경계뿐. 원래 const인 객체를 수정하면 UB — 같은 주소에서 `limit`=250, `*p`=999가 나오는 모순을 실측했고, 이 결과에 보장은 없다.
- reinterpret_cast는 하드웨어 주소 같은 "타입 시스템 밖의 사실"용. 바이트 버퍼에서 값 꺼내기는 memcpy — `-O2`에서 `movss` 한 명령으로 컴파일됨을 실측했다. 포인터 재해석은 정렬 위반(UBSan 실측)과 strict aliasing 위반을 동시에 밟는다.
- dynamic_cast는 유일한 런타임 검사 캐스트 — [3.4](#/virtual-vtable)로 미룬다.
- 축소를 막는 그물 세 겹: 중괄호 초기화(g++ 13 실측 — 리터럴은 에러, 변수는 경고이므로 `-Werror=narrowing`), `-Wconversion`, 그리고 경계에서는 검사 후 변환(gsl::narrow 관용구).

::: quiz 연습문제
1번은 예측, 2번은 개념, 3~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. 다음 코드의 출력을 **컴파일하지 말고** 예측하라. 근거를 한 문장으로 써라.

   ```cpp
   int wheel_ticks = 7;
   int interval_ms = 2;
   double speed = wheel_ticks / interval_ms * 0.5;
   std::cout << speed;
   ```

2. `const_cast<char*>(s.c_str())`를 레거시 함수에 넘기는 코드가 합법인지 UB인지는 캐스트 지점만 봐서는 판정할 수 없다. 판정에 필요한 정보 두 가지를 말하라.

3. (실습) C 캐스트를 처형하라: `const double` 변수의 주소를 `(double*)`로 벗겨서 수정하는 코드를 쓰고 컴파일이 침묵하는 것을 확인한 뒤, 그 캐스트를 `static_cast<double*>`로 바꿔 에러를 드러내라. 성공 기준: C 캐스트 버전은 `-Wall -Wextra`에서 경고 0, static_cast 버전은 `invalid 'static_cast'` 에러.

4. (실습) 절단 편향 확인: `double v = 0.0;`에서 시작해 루프 1000번 동안 `v += 0.1;`을 하고, 매번 `static_cast<int>(v * 10)`과 `std::lround(v * 10)`을 누적 합산해 두 합의 차이를 출력하라. 성공 기준: 두 합이 다르고, 어느 쪽이 왜 작은지 [1.2](#/types)의 부동소수점 표현으로 설명할 수 있다.

5. (실습) memcpy의 비용 확인: 본문 `parse_roll`을 그대로 치고 `g++ -std=c++20 -O2 -c parse.cpp && objdump -d parse.o`로 생성된 명령을 세어 보라. 그다음 `-O0`으로 다시 컴파일해 두 출력을 비교하라. 성공 기준: `-O2`에서 메모리 읽기 명령 하나(x86-64에서는 `movss`), 그리고 **두 레벨 모두 memcpy로의 `call`이 없다**는 것을 확인한다.
:::

::: answer 해설
1. 출력은 `1.5`다. `wheel_ticks / interval_ms`는 int끼리라 정수 나눗셈으로 3이 되고(0.5가 아니라), 그 3이 `* 0.5`에서 double로 승격돼 1.5가 된다. 나눗셈까지 실수로 계산하고 싶었다면 7/2 = 3.5 → 1.75가 정답이었을 것이다 — `static_cast<double>(wheel_ticks) / interval_ms * 0.5`처럼 **가장 안쪽 연산 전에** 변환을 넣어야 한다.
2. ① 원본 객체가 원래 const로 태어났는가(태생이 const인 객체를 수정하면 UB, non-const 객체가 const 경로로 전달된 것뿐이면 합법). ② 그 함수가 포인터로 실제로 쓰기를 하는가(수정하지 않으면 어느 쪽이든 UB가 아니다). 캐스트의 안전성이 캐스트 지점 밖 — 객체의 출생과 피호출자의 행동 — 에 달려 있다는 것이 const_cast를 격리해야 하는 이유다.
3. g++ 13 실측 기준: `(double*)` 버전은 `-Wall -Wextra`로 완전 침묵, `static_cast<double*>` 버전은 `error: invalid 'static_cast' from type 'const double*' to type 'double*'`. 수정까지 실행해 봤다면 본문 constcast.cpp처럼 원본 변수와 포인터가 다른 값을 찍는 것도 볼 수 있다 — 그리고 그 출력에는 보장이 없다(UB).
4. static_cast 합이 lround 합보다 작다. 0.1은 이진법으로 정확히 저장되지 않으므로([1.2](#/types)) `v * 10`은 정수 근처의 값(9.9999… 또는 10.0000…1)이 되는데, lround는 양쪽을 다 가장 가까운 정수로 보내는 반면 절단은 9.9999…를 9로 떨어뜨린다. 오차가 한 방향으로만 쌓이는 것 — 이것이 본문에서 말한 편향이다.
5. `-O2`에서는 함수 본문이 `endbr64` / `movss (%rdi),%xmm0` / `ret` — 메모리 접근 명령은 movss 하나다(g++ 13, x86-64 실측). `-O0`에서도 memcpy로의 `call`은 없다 — 크기가 상수인 memcpy를 g++가 최적화를 끄고도 mov 몇 개로 인라인 전개하기 때문이다(실측: 스택을 경유하는 mov들만 남는다). "memcpy를 부르면 함수 호출 비용이 든다"는 걱정이 어느 레벨에서도 성립하지 않는다는 것을 눈으로 확인하는 것이 이 실습의 목적이다.
:::

이 절의 코드도 전부 직접 쳐라. 특히 `implicit.cpp` → `ccast.cpp` → `constcast.cpp` → `packet.cpp` 순서로, 예측 → 실행 → 비교의 리듬을 유지하라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -Wconversion main.cpp -o main && ./main`, packet.cpp는 UBSan 버전(`g++ -std=c++20 -fsanitize=undefined packet.cpp && ./a.out`)까지 돌려서 misaligned load 리포트를 눈으로 확인하라.

**다음 절**: [1.5 제어 흐름과 표현식](#/control-flow) — 타입과 변환을 알았으니 이제 그 값들이 흐르는 길이다. `f(a++, a++)`의 결과가 왜 정해져 있지 않은지, 평가 순서의 지뢰부터 연다.
