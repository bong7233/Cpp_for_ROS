# 4.6 constexpr와 컴파일 타임 계산

::: lead
[1.3](#/variables)은 "`constexpr`는 값이 컴파일 타임에 확정된다는 것까지 약속한다"는 한 문장을 던지고 이 절로 미뤘다. 헥사포드 다리 개수, 제어 주기, 링크 길이처럼 프로그램이 도는 내내 안 바뀌는 값이 로봇 코드 곳곳에 있다. 이런 값을 매크로나 `const`로 다루던 관행이 왜 부족한지부터 본 뒤, `constexpr` 변수·함수, [4.2](#/class-templates)의 `std::array<T, N>` 비타입 매개변수 자리를 채우는 법, C++20의 `consteval`, C++17의 `constexpr if`까지 — 계산의 일부를 실행 파일이 만들어지는 순간에 이미 끝내 버리는 도구 전체를 gdb와 objdump로 직접 확인한다.
:::

## 매크로와 const로는 부족한 지점

로봇 제어 코드에는 흔히 이런 줄이 있다.

```cpp title="legacy_macro.cpp — 매크로로 로봇 상수를 정의한 코드"
#define NUM_JOINTS 18

int main() {
    int total = NUM_JOINTS * 2;
    return total;
}
```

[1.1 컴파일 모델](#/compile-model)에서 이미 `SQUARE(x)` 매크로가 괄호 없이 쓰이면 연산자 우선순위를 깨뜨리는 것을 봤다. 매크로의 문제는 치환 함정 하나로 끝나지 않는다 — **매크로에는 타입이 없고, 그래서 디버거에 존재 자체가 안 보인다.** 실측한다.

```console
$ g++ -std=c++20 -Wall -Wextra -g legacy_macro.cpp -o legacy_macro
$ gdb -q --batch -ex "break main" -ex "run" -ex "next" -ex "print NUM_JOINTS" ./legacy_macro
Breakpoint 1 at 0x1131: file legacy_macro.cpp, line 4.
Breakpoint 1, main () at legacy_macro.cpp:4
4	    int total = NUM_JOINTS * 2;
No symbol "NUM_JOINTS" in current context.
```

(g++ 13.3 / gdb 실측.) `NUM_JOINTS`는 전처리 단계에서 `18`로 치환되고 완전히 사라진다 — 디버그 정보(`-g`)에도 남을 이름 자체가 없다. 실행 중인 로봇 제어 프로세스에 gdb로 붙어서 물어볼 대상이 없다는 뜻이다. 같은 값을 `constexpr`로 선언하면 사정이 달라진다.

```cpp title="constexpr_const.cpp — 같은 값을 constexpr로 선언한다"
constexpr int kNumJoints = 18;

int main() {
    int total = kNumJoints * 2;
    return total;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g constexpr_const.cpp -o constexpr_const
$ gdb -q --batch -ex "break main" -ex "run" -ex "next" -ex "print kNumJoints" ./constexpr_const
Breakpoint 1 at 0x1131: file constexpr_const.cpp, line 4.
Breakpoint 1, main () at constexpr_const.cpp:4
4	    int total = kNumJoints * 2;
$1 = 18
```

(g++ 13.3 / gdb 실측.) `$1 = 18` — `constexpr` 변수는 이름과 타입을 가진 진짜 심볼이라 디버거가 그대로 읽어낸다. 매크로가 "컴파일 전에 사라지는 텍스트"라면, `constexpr`는 "컴파일 후에도 이름이 남는 값"이다.

디버거 가시성은 `constexpr`가 매크로를 이기는 이유 중 하나일 뿐, 더 근본적인 문제는 따로 있다. `const`로 옮겨 적으면 매크로의 두 문제(치환 함정, 디버거 무명씨)는 사라지지만, `const`에는 `constexpr`에 없는 구멍이 하나 있다 — **"실행 중에 안 바뀐다"는 것과 "컴파일 타임에 이미 정해져 있다"는 것은 다른 약속이다.**

```cpp title="const_notenough.cpp — const지만 컴파일 타임 값은 아니다"
#include <iostream>

int main() {
    int n = 0;
    std::cin >> n;
    const int size = n;   // n을 그대로 옮겼을 뿐 -- const지만 값은 실행 중에야 정해진다
    int arr[size];         // 표준 배열 크기 자리에 컴파일 타임 상수가 아닌 값을 썼다
    arr[0] = 1;
    std::cout << arr[0] << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra const_notenough.cpp -o const_notenough
$ echo $?
0
```

(g++ 13.3 실측.) `-Wall -Wextra`를 붙여도 경고 없이 통과한다. 표준 C++에는 가변 길이 배열(VLA)이 없는데도, GCC가 자기 확장 문법으로 조용히 받아 준 것이다 — 이식 가능한 C++이 아니라 여기서만 되는 GNU 확장이다. `-pedantic`을 더해야 정체가 드러난다.

```console
$ g++ -std=c++20 -Wall -Wextra -pedantic const_notenough.cpp -o const_notenough
const_notenough.cpp:7:9: warning: ISO C++ forbids variable length array 'arr' [-Wvla]
    7 |     int arr[size];         // 표준 배열 크기 자리에 컴파일 타임 상수가 아닌 값을 썼다
      |         ^~~
```

(g++ 13.3 실측 — `-pedantic`을 붙여도 **경고**일 뿐, 빌드는 안 막힌다.) `ISO C++ forbids`가 정확히 짚는다 — 표준이 아니라 GCC가 얹어 준 편의다. 플래그가 다르거나 다른 컴파일러로 옮기면 이 코드는 그냥 깨진다.

::: danger 조용히 통과한 코드가 제일 위험하다
`-Wall -Wextra`만 켠 상태에서 `const_notenough.cpp`는 경고 0개로 빌드된다. 리뷰어가 눈치채지 못하면 그대로 커밋되고 다른 컴파일 환경에서만 뒤늦게 터진다. `const`는 "안 바뀐다"만 보장하지 "컴파일 타임에 정해진다"는 보장하지 않는다는 것이 이 함정이다.
:::

같은 `n`을 `std::array`([4.2](#/class-templates))의 크기 자리에 넣으면 GNU 확장이 끼어들 여지 자체가 없다 — 비타입 템플릿 매개변수는 GCC도 봐줄 수 없는 자리다.

```cpp title="array_needs_constexpr.cpp — 템플릿 비타입 인자 자리는 봐주는 확장이 없다"
#include <array>
#include <iostream>

int main() {
    int n = 0;
    std::cin >> n;
    const int size = n;          // const지만 컴파일 타임 상수는 아니다
    std::array<int, size> arr{}; // N 자리에는 컴파일 타임 값이 필수다
    std::cout << arr.size() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra array_needs_constexpr.cpp -o array_needs_constexpr
array_needs_constexpr.cpp:8:25: error: the value of 'size' is not usable in a constant expression
    8 |     std::array<int, size> arr{}; // N 자리에는 컴파일 타임 값이 필수다
      |                         ^
array_needs_constexpr.cpp:7:15: note: 'size' was not initialized with a constant expression
    7 |     const int size = n;          // const지만 컴파일 타임 상수는 아니다
      |               ^~~~
```

(g++ 13.3 실측.) 이번엔 경고가 아니라 **에러**다. `array<T, N>`의 `N`은 [4.2](#/class-templates)의 비타입 템플릿 매개변수라, 타입 자체가 그 값으로 결정되므로 실행 중에야 정해지는 값은 후보가 될 수 없다. `int arr[size]`는 GCC가 봐줬지만 `std::array<int, size>`는 표준의 핵심 규칙이라 우회로가 없다.

## constexpr 변수: 컴파일 타임에 확정되는 값

`const`의 구멍을 메우는 도구가 `constexpr`다. `constexpr` 변수는 **컴파일러가 그 값을 컴파일 타임에 계산해 낼 수 있어야 한다**는 것을 강제한다. `size`를 `constexpr`로 바꾸면 방금 본 에러가 변수 선언 자리에서 재현된다.

```cpp title="constexpr_var_fail.cpp — 런타임 값을 constexpr에 넣으면 그 자리에서 막힌다"
#include <iostream>

int main() {
    int n = 0;
    std::cin >> n;
    constexpr int size = n;   // n은 런타임에만 정해지는데 constexpr로 선언했다
    std::cout << size << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra constexpr_var_fail.cpp -o constexpr_var_fail
constexpr_var_fail.cpp:6:26: error: the value of 'n' is not usable in a constant expression
    6 |     constexpr int size = n;   // n은 런타임에만 정해지는데 constexpr로 선언했다
      |                          ^
constexpr_var_fail.cpp:4:9: note: 'int n' is not const
    4 |     int n = 0;
      |         ^
```

(g++ 13.3 실측.) 이번엔 변수 선언 자체가 거부됐다 — `constexpr`는 장식이 아니라 "컴파일 타임에 계산 가능한 값"만 받아들이는 규칙이다. 이 덕분에 컴파일 타임 상수가 필요한 자리(배열 크기, 비타입 인자, `static_assert` 조건) 어디든 그대로 쓸 수 있다.

```cpp title="constexpr_var_ok.cpp — 배열 크기와 array<T,N> 둘 다에 그대로 쓴다"
#include <array>
#include <iostream>

constexpr int kNumLegs = 6;

int main() {
    int plain_arr[kNumLegs];               // 표준 배열 크기 -- 확장 없이 정상 문법
    std::array<double, kNumLegs> legs{};   // 비타입 템플릿 인자 -- 정확히 이 자리에 맞는 값
    plain_arr[0] = 1;
    std::cout << sizeof(plain_arr) / sizeof(int) << " " << legs.size() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra constexpr_var_ok.cpp -o constexpr_var_ok
$ ./constexpr_var_ok
6 6
```

(g++ 13.3 실측.) `-pedantic`을 더해도 이번엔 `-Wvla` 경고가 나오지 않는다 — `kNumLegs`가 진짜 컴파일 타임 상수라 GNU 확장을 빌릴 이유 자체가 없기 때문이다.

::: deep 상수 표현식이란 정확히 무엇인가
`constexpr`가 요구하는 "컴파일 타임에 계산 가능"의 표준 용어는 **상수 표현식(constant expression)**이다 — 리터럴, 다른 `constexpr` 값, 사칙연산처럼 프로그램을 실행하지 않고도 값을 도출할 수 있는 식이다. 배열 크기, 템플릿 인자, `static_assert` 조건, `constexpr` 변수의 초기화 식이 이 자격을 요구하는 자리(**required constant expression** 컨텍스트)다 — 여기 못 들어가면 그 즉시 에러가 난다.
:::

## constexpr 함수: 컴파일 타임에도, 런타임에도

값 하나를 상수로 못박는 것을 넘어, 계산 자체를 컴파일 타임으로 옮기고 싶을 때가 있다. `constexpr` 함수는 **"컴파일 타임 컨텍스트에서 호출되면 컴파일 타임에, 아니면 런타임에"** 동작하는 함수다 — 같은 코드 한 벌이 두 세계에 산다.

```cpp title="constexpr_fn.cpp — 같은 함수를 컴파일 타임과 런타임 양쪽에서 호출한다"
#include <iostream>

constexpr int square(int x) {
    return x * x;
}

int main() {
    static_assert(square(5) == 25);   // 컴파일 타임 호출 -- static_assert 안에서 평가된다

    int n = 0;
    std::cin >> n;
    std::cout << square(n) << "\n";   // 런타임 호출 -- n은 실행 중에만 정해진다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra constexpr_fn.cpp -o constexpr_fn
$ echo 7 | ./constexpr_fn
49
```

(g++ 13.3 실측.) `static_assert(square(5) == 25)`는 컴파일이 끝나기 전에 참·거짓이 결정돼야 하는 자리라 `square(5)`는 컴파일 타임에 평가된다. 반면 `square(n)`의 `n`은 `std::cin`으로 실행 중에 들어오니 컴파일 타임 값이 될 방법이 없어 그냥 평범한 함수 호출로 컴파일된다. **같은 `square`가 두 자리에서 다르게 동작한 게 아니라, 호출하는 쪽의 사정에 따라 컴파일러가 다르게 처리한 것**이다.

"컴파일 타임에 계산됐다"는 말이 어셈블리에서 무엇을 뜻하는지 objdump로 확인한다. 컴파일 타임 상수 호출(`kSquared7`)과 실행 인자 호출(`square(argc)`)을 나란히 둔다.

```cpp title="constexpr_asm.cpp — 컴파일 타임 호출과 런타임 호출을 한 파일에"
#include <cstdio>

constexpr int square(int x) {
    return x * x;
}

constexpr int kSquared7 = square(7);   // 컴파일 타임에 49로 확정된다

int main(int argc, char**) {
    std::printf("%d\n", kSquared7);       // 상수 49
    std::printf("%d\n", square(argc));    // argc는 런타임에만 정해진다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -c constexpr_asm.cpp -o constexpr_asm.o
$ objdump -d -r -M intel constexpr_asm.o
0000000000000000 <main>:
   ...
  13:	be 31 00 00 00       	mov    esi,0x31
   ...
  27:	e8 00 00 00 00       	call   2c <main+0x2c>
			28: R_X86_64_PLT32	printf-0x4
  2c:	8b 45 fc             	mov    eax,DWORD PTR [rbp-0x4]
  2f:	89 c7                	mov    edi,eax
  31:	e8 00 00 00 00       	call   36 <main+0x36>
			32: R_X86_64_PLT32	_Z6squarei-0x4
```

(g++ 13.3 / -O0 / objdump -r 실측. `-O0`을 쓴 것은 최적화가 인라인으로 지워 버리면 두 경로의 차이가 안 보이기 때문이다.) `0x31`은 16진수로 49다 — `kSquared7` 자리에는 `square`를 부르는 코드가 없고 상수만 실려 있다. 반면 `square(argc)` 자리는 재배치(`R_X86_64_PLT32 _Z6squarei-0x4`)가 붙은 진짜 `call`이다 — `_Z6squarei`는 [1.10 링크리지](#/linkage)의 맹글링된 이름 그대로다. `nm`으로 보면 더 분명하다.

```console
$ nm constexpr_asm.o
0000000000000000 W _Z6squarei
0000000000000000 r _ZL9kSquared7
0000000000000000 T main
                 U printf
```

(g++ 13.3 실측.) `square`는 실제로 존재한다 — `square(argc)`가 실행 중에 불러야 하기 때문이다. 하지만 `kSquared7`을 만드는 과정은 어디에도 없다. 컴파일러가 `square(7)`을 컴파일 타임에 계산해 결과값 `49`만 데이터로 남기고 계산 과정은 버린 것이다.

::: hist constexpr 함수는 처음부터 이렇게 자유롭지 않았다
C++11의 `constexpr` 함수는 본문이 `return` 문 하나뿐이어야 했다 — 컴파일 타임 평가기를 단순한 재귀 치환기 수준으로만 구현해도 되게 하려는 보수적인 선택이었다. C++14가 반복문·중간 재대입을 허용해 지금처럼 평범한 명령형 코드를 그대로 쓸 수 있게 됐다 — 아래 룩업 테이블 생성 함수가 C++11에서는 불가능했던 이유다.
:::

## 컴파일 타임 룩업 테이블: 서보 펄스폭 변환표

`constexpr` 함수가 반복문을 쓸 수 있다는 것은 **테이블 전체를 프로그램이 시작하기도 전에 채워 넣을 수 있다**는 뜻이다. 서보 모터 제어에서 흔한 표 하나를 만든다 — 관절 각도(도)를 PWM 펄스폭(마이크로초)으로 바꾸는 선형 변환표다.

```cpp title="pulse_table.cpp — 각도-펄스폭 변환표를 컴파일 타임에 통째로 채운다"
#include <array>
#include <cstdio>

constexpr int kMinAngleDeg = -90;
constexpr int kMaxAngleDeg = 90;
constexpr int kTableSize = kMaxAngleDeg - kMinAngleDeg + 1;   // 181칸

// 서보 스펙: -90도 -> 1000us, 0도 -> 1500us, +90도 -> 2000us, 선형 매핑
constexpr int angle_to_pulse_us(int angle_deg) {
    return 1500 + (angle_deg * 500) / 90;
}

constexpr std::array<int, kTableSize> make_pulse_table() {
    std::array<int, kTableSize> table{};
    for (int i = 0; i < kTableSize; ++i) {
        table[i] = angle_to_pulse_us(kMinAngleDeg + i);
    }
    return table;
}

constexpr auto kPulseTable = make_pulse_table();   // 181개 값이 컴파일 타임에 전부 계산된다

int main(int argc, char**) {
    int angle = argc * 10;               // 실행마다 달라지는 값(런타임)
    std::printf("angle=%d -> pulse=%dus\n", angle, kPulseTable[angle - kMinAngleDeg]);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 pulse_table.cpp -o pulse_table
$ ./pulse_table
angle=10 -> pulse=1555us
```

(g++ 13.3 실측.) 실행 결과는 평범하다 — 진짜 확인할 것은 **"181번 반복하는 루프가 실행 파일 어디에 있는가"**다.

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -c pulse_table.cpp -o pulse_table.o
$ nm pulse_table.o
0000000000000008 r _ZL10kTableSize
0000000000000020 r _ZL11kPulseTable
0000000000000004 r _ZL12kMaxAngleDeg
0000000000000000 r _ZL12kMinAngleDeg
0000000000000000 W _ZNKSt5arrayIiLm181EEixEm
0000000000000000 T main
                 U printf
```

(g++ 13.3 실측.) `make_pulse_table`도 `angle_to_pulse_us`도 심볼 목록에 없다 — 루프 코드가 오브젝트 파일에 없다는 뜻이다. 대신 `_ZL11kPulseTable`이라는 **데이터** 심볼(`r` = 읽기 전용)만 있다. `.rodata`를 열어 값이 채워져 있는지 확인한다.

```console
$ objdump -s -j .rodata pulse_table.o
Contents of section .rodata:
 0020 e8030000 ee030000 f4030000 f9030000  ................
 0030 ff030000 04040000 0a040000 0f040000  ................
```

(g++ 13.3 실측.) `kPulseTable`은 오프셋 `0x20`에서 시작한다. 리틀 엔디안으로 읽으면 첫 4바이트 `e8 03 00 00`은 `0x3e8 = 1000`이다 — 각도 -90도(0번째 칸)의 펄스폭 1000us와 정확히 일치한다. 다음 칸 `ee 03 00 00 = 0x3ee = 1006`은 -89도의 값이다. 181개 값 전부가 링크 단계 이전에 이미 바이너리 안에 박혀 있다.

::: perf 룩업 테이블의 실제 이득은 "첫 호출 지연이 없다"는 것
런타임에 채우는 버전과 비교했을 때 이득은 "계산이 빠르다"가 아니다 — 정수 나눗셈 181번은 마이크로초 단위에서도 안 잡힐 만큼 싸다. 진짜 이득은 **`main`이 시작되는 순간 테이블이 이미 완성돼 있다는 것**이다. 런타임 초기화 버전은 첫 사용 시점에 그 루프를 한 번 돌아야 하고, 그 지연은 재현하기 까다로운 지터로 나타날 수 있다. [6.8 실시간 제어 루프](#/realtime)의 "예측 불가능한 지연을 만들지 마라"와 맞닿는다.
:::

## consteval: "가능하면"에서 "반드시"로 (C++20)

`constexpr` 함수는 컴파일 타임에도 런타임에도 호출될 수 있는 **선택지**를 준다. 그런데 컴파일 타임에만 검증하고 싶은 설정값 계산처럼, 애초에 런타임에 불리면 의미가 없는 함수도 있다. C++20의 `consteval`은 그 선택지를 없애고 **반드시 컴파일 타임에만 평가되도록 강제**한다.

```cpp title="consteval_test.cpp — 런타임 인자로 부르면 그 자리에서 막힌다"
#include <iostream>

consteval int square_ct(int x) {
    return x * x;
}

int main() {
    constexpr int a = square_ct(5);   // 컴파일 타임 인자 -- 통과
    std::cout << a << "\n";

    int n = 0;
    std::cin >> n;
    std::cout << square_ct(n) << "\n";   // n은 런타임에만 정해진다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra consteval_test.cpp -o consteval_test
consteval_test.cpp:13:28: error: the value of 'n' is not usable in a constant expression
   13 |     std::cout << square_ct(n) << "\n";   // n은 런타임에만 정해진다
      |                            ^
consteval_test.cpp:11:9: note: 'int n' is not const
   11 |     int n = 0;
      |         ^
```

(g++ 13.3 실측.) 앞서 본 `constexpr` 함수 `square`는 같은 자리에서 `square(n)`을 문제없이 통과시켰다 — 컴파일 타임 값이 안 되면 런타임 호출로 물러났기 때문이다. `consteval` 함수 `square_ct`는 그 후퇴로가 막혀 있다 — 컴파일 타임 평가에 실패하면 물러날 곳 없이 에러다. "이 계산은 실수로라도 런타임에 새어 나가면 안 된다"는 것을 함수 시그니처 자체에 못박는 지점이 `consteval`의 쓸모다.

::: tip constexpr와 consteval, 뭘 기본값으로 쓸까
런타임에 불릴 일이 실제로 있는 함수라면 `constexpr`가 기본이다. 컴파일 타임 전용이라는 것을 문서가 아니라 컴파일러가 강제해 주길 원하면(설정 검증, 테이블 생성 헬퍼) `consteval`을 쓴다. 헷갈리면 `constexpr`로 시작하고, "이건 런타임에 불리면 안 된다"가 확실해지는 시점에 `consteval`로 좁혀도 된다.
:::

## constexpr if: 템플릿 안에서 컴파일 타임 분기 (C++17)

템플릿 함수 안에서 타입에 따라 다른 코드를 실행하고 싶을 때가 있다. 엔코더 원시 카운트(정수)는 나머지 연산으로 접어야 하고, 관절 각도(라디안, 부동소수점)는 `fmod`로 접어야 한다 — 로직 자체가 타입마다 다르다. 평범한 `if`로 먼저 짜 보면 무슨 일이 생기는지 실측한다.

```cpp title="wrap_domain_fail.cpp — 보통의 if는 두 분기 다 항상 컴파일된다"
#include <cmath>
#include <iostream>
#include <type_traits>

constexpr int kTicksPerRev = 4096;

template <typename T>
T wrap_to_range(T v) {
    if (std::is_integral_v<T>) {          // 런타임 if -- 조건과 무관하게 두 분기 다 컴파일된다
        return v % kTicksPerRev;           // T가 double이면 %가 정의되지 않는다
    } else {
        constexpr T pi = static_cast<T>(3.14159265358979323846);
        T r = std::fmod(v + pi, 2 * pi);
        if (r < 0) r += 2 * pi;
        return r - pi;
    }
}

int main() {
    std::cout << wrap_to_range(4.0) << "\n";   // T = double
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra wrap_domain_fail.cpp -o wrap_domain_fail
wrap_domain_fail.cpp: In instantiation of 'T wrap_to_range(T) [with T = double]':
wrap_domain_fail.cpp:20:31:   required from here
wrap_domain_fail.cpp:10:18: error: invalid operands of types 'double' and 'const int' to binary 'operator%'
   10 |         return v % kTicksPerRev;           // T가 double이면 %가 정의되지 않는다
      |                ~~^~~~~~~~~~~~~~
```

(g++ 13.3 실측.) `T = double`로 인스턴스화하면 실행 중에는 그 분기를 절대 안 타는데도 컴파일이 막힌다 — 보통의 `if`는 **런타임 분기**라서, 컴파일러는 두 분기 모두를 `T = double`로 인스턴스화하려 시도하고 `v % kTicksPerRev`가 `double`에는 정의되지 않아 실패한다. `if`를 `if constexpr`로 바꾸면 달라진다.

```cpp title="wrap_domain.cpp — if constexpr는 선택 안 된 분기를 통째로 버린다"
#include <cmath>
#include <iostream>
#include <type_traits>

constexpr int kTicksPerRev = 4096;   // 엔코더 한 바퀴당 카운트 수

template <typename T>
T wrap_to_range(T v) {
    if constexpr (std::is_integral_v<T>) {
        // 엔코더 원시 카운트(정수): 나머지 연산으로 한 바퀴 안으로 접는다
        return v % kTicksPerRev;
    } else {
        // 관절 각도(라디안, 부동소수점): fmod로 -pi ~ +pi 범위로 접는다
        constexpr T pi = static_cast<T>(3.14159265358979323846);
        T r = std::fmod(v + pi, 2 * pi);
        if (r < 0) r += 2 * pi;
        return r - pi;
    }
}

int main() {
    std::cout << wrap_to_range(4200) << "\n";   // T = int: 엔코더 카운트
    std::cout << wrap_to_range(4.0) << "\n";    // T = double: 라디안 각도
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra wrap_domain.cpp -o wrap_domain
$ ./wrap_domain
104
-2.28319
```

(g++ 13.3 실측.) 4200을 4096으로 나눈 나머지 104가 정확히 나온다. `-2.28319`도 계산대로다 — 4라디안(약 229도)을 -π~+π 범위로 접으면 한 바퀴 넘긴 만큼이 반대쪽에서 나온다. `if constexpr`의 조건은 `T`가 확정되는 인스턴스화 시점에 이미 참·거짓이 정해지는 컴파일 타임 조건이라, 거짓인 분기는 **문법 검사조차 없이 통째로 버려진다** — `T = double`에서 `v % kTicksPerRev`가 같은 함수 안에 있어도 막히지 않는 이유다.

::: note 이게 SFINAE를 대신하지는 않는다
`if constexpr`는 이미 선택된 타입에 대해 몸통 **안**의 분기를 고르는 것이고, "이 타입이 함수의 후보가 될 수 있는가"를 오버로드 해석 단계에서 거르는 것과는 다른 문제다. 후자는 `requires` 절과 concepts([4.5](#/concepts))의 영역(몸통 **밖**의 후보 제한)이라 서로 대신하는 관계가 아니라 같이 쓰는 관계다.
:::

## 로봇 도메인: 링크 길이·제어 주기를 컴파일 타임 상수로

지금까지 본 도구를 헥사포드 다리 설계값에 그대로 적용한다. coxa·femur·tibia 세 링크의 길이는 기구 설계 단계에서 정해지고 실행 중에는 절대 바뀌지 않는다 — `constexpr`로 선언하면 파생값(최대 도달 거리)까지 컴파일 타임에 확정되고, 설계값이 말이 되는지를 `static_assert`로 **컴파일 타임에** 검증할 수 있다.

```cpp title="robot_constants.cpp — 링크 길이와 제어 주기를 컴파일 타임 상수로"
#include <cstdio>

// 헥사포드 다리 한 짝의 링크 길이(미터) -- 기구 설계값, 실행 중에 안 바뀐다
constexpr double kCoxaLen  = 0.052;
constexpr double kFemurLen = 0.086;
constexpr double kTibiaLen = 0.130;

// 다 편 다리의 최대 도달 거리 -- 컴파일 타임에 이미 확정된다. 9.5 역기구학의 입력 상수다
constexpr double kMaxLegReach = kCoxaLen + kFemurLen + kTibiaLen;

static_assert(kMaxLegReach > 0.2, "다리 길이 합이 너무 짧다 -- 설계값을 다시 확인하라");

constexpr double kControlPeriodSec = 0.004;   // 1.3에서 본 250Hz 제어 주기
constexpr int kTicksPerSecond = static_cast<int>(1.0 / kControlPeriodSec);

int main() {
    std::printf("최대 도달 거리 = %.3fm\n", kMaxLegReach);
    std::printf("제어 주기당 틱 수 = %d\n", kTicksPerSecond);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra robot_constants.cpp -o robot_constants
$ ./robot_constants
최대 도달 거리 = 0.268m
제어 주기당 틱 수 = 250
```

(g++ 13.3 실측.) `kMaxLegReach`와 `kTicksPerSecond` 둘 다 `main` 실행 전에 이미 확정된 상수다 — 계산 코드로 남지 않는다(같은 원리를 `pulse_table.cpp`에서 이미 확인했다). `static_assert`는 실제로 설계 실수를 잡아낸다 — 링크 길이를 10분의 1로 줄여 넣어 본다.

```cpp title="robot_constants_fail.cpp — 설계 실수를 컴파일 타임에 잡는다"
constexpr double kCoxaLen  = 0.01;
constexpr double kFemurLen = 0.02;
constexpr double kTibiaLen = 0.03;
constexpr double kMaxLegReach = kCoxaLen + kFemurLen + kTibiaLen;
static_assert(kMaxLegReach > 0.2, "다리 길이 합이 너무 짧다 -- 설계값을 다시 확인하라");
int main() { return 0; }
```

```console
$ g++ -std=c++20 -Wall -Wextra robot_constants_fail.cpp -o robot_constants_fail
robot_constants_fail.cpp:5:28: error: static assertion failed: 다리 길이 합이 너무 짧다 -- 설계값을 다시 확인하라
    5 | static_assert(kMaxLegReach > 0.2, "다리 길이 합이 너무 짧다 -- 설계값을 다시 확인하라");
      |               ~~~~~~~~~~~~~^~~~~
robot_constants_fail.cpp:5:28: note: the comparison reduces to '(5.9999999999999998e-2 > 2.0000000000000001e-1)'
```

(g++ 13.3 실측.) 링크 길이 합이 설계 하한을 못 넘긴다는 사실이 로봇을 조립해 보기도 전에 **컴파일 단계에서** 드러난다 — 잘못된 설계값으로는 바이너리 자체가 만들어지지 않는다. `kMaxLegReach`는 [9.5 역기구학](#/inverse-kinematics)의 입력값으로, `kTicksPerSecond`는 [6.8 실시간 제어 루프](#/realtime)의 파생 기준으로 다시 쓰인다.

::: interview "constexpr와 const, constexpr와 consteval의 차이를 설명하라"
**constexpr vs const**: `const`는 "초기화된 뒤로 값이 안 바뀐다"만 약속하고 초기화 자체는 런타임 계산이어도 된다. `constexpr`는 "값이 컴파일 타임에 계산 가능해야 한다"까지 강제한다 — 배열 크기, 템플릿 비타입 인자, `static_assert` 조건처럼 컴파일 타임 값이 필수인 자리에는 `constexpr`가 필요하다. 근거: `const_notenough.cpp`(GNU 확장에 의존)와 `array_needs_constexpr.cpp`(확장도 못 피함)의 대비.

**constexpr vs consteval**: `constexpr` 함수는 "가능하면 컴파일 타임에, 안 되면 런타임에" 동작하는 이중 신분이다 — 같은 `square`가 `static_assert` 안에서는 컴파일 타임에, `std::cin` 변수에는 런타임에 불렸다. `consteval`은 그 후퇴로를 없애 반드시 컴파일 타임에만 평가되도록 강제한다. 요약: `constexpr`는 "가능하면", `consteval`은 "무조건".
:::

## 요약

- 매크로 상수는 타입이 없어 디버거에서 안 보인다(gdb 실측: `No symbol "NUM_JOINTS"`) — `constexpr` 변수는 진짜 심볼이라 `print`된다(`$1 = 18`).
- `const`는 "안 바뀐다"만 보장하고 "컴파일 타임에 정해진다"는 보장 안 한다 — 런타임 `const` 값을 배열 크기에 쓰면 GCC가 GNU 확장으로 조용히 통과시키지만, `std::array<T, N>`의 비타입 인자는 어떤 확장도 못 봐준다(실측).
- `constexpr` 함수는 컴파일 타임 컨텍스트에서 불리면 컴파일 타임에, 아니면 런타임에 동작한다 — objdump 실측으로 상수만 남고 함수 호출이 사라지는 것을 확인했다.
- 반복문을 쓰는 `constexpr` 함수로 룩업 테이블 전체를 컴파일 타임에 채울 수 있다 — 서보 펄스폭 변환표 181칸이 `.rodata`에 구워져 있는 것을 실측했다. 이득은 계산 속도가 아니라 첫 호출 지연이 없다는 것이다.
- `consteval`(C++20)은 런타임 호출을 컴파일 에러로 막는다 — `constexpr`가 "가능하면"이라면 `consteval`은 "무조건"이다(실측).
- `constexpr if`(C++17)는 인스턴스화되지 않는 분기를 문법 검사 단계부터 통째로 버린다 — 보통의 `if`는 타지 않는 분기도 컴파일이 시도돼 에러가 난다(실측).
- 링크 길이·제어 주기처럼 안 바뀌는 로봇 설계값은 `constexpr`로 선언해 파생값을 확정하고, `static_assert`로 설계 오류를 빌드 단계에서 잡는다(실측).

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일해서 확인하는 실습이다.

1. `const int size = n;`(n은 `std::cin`으로 받은 변수)과 `constexpr int size = n;`은 각각 컴파일되는가? 근거를 이 절의 실측에서 하나씩 인용하라.

2. `constexpr` 함수와 `consteval` 함수를 똑같이 런타임 변수로 호출하면 각각 어떻게 되는가?

3. (실습, 코드 작성형) 관절 전류(암페어, -3.0~3.0)를 ADC 원시값(0~4095)으로 바꾸는 `constexpr` 함수 `current_to_adc(double amps)`를 짜라. `static_assert`로 `current_to_adc(0.0)`이 중간값 근처인지 컴파일 타임에 검증하고, `main`에서는 `std::cin`으로 받은 실수값으로 런타임 호출도 해 봐라. 성공 기준: 경고 없이 컴파일되고, `static_assert`가 통과하며, 런타임 호출도 정상 출력된다.

4. (실습) `constexpr_asm.cpp`를 그대로 타이핑하고 `g++ -std=c++20 -O0 -c` 후 `objdump -d -r -M intel`로 `main`을 열어라. 성공 기준: `kSquared7` 자리에 `call`이 없고 `mov ... , 0x31`(49)만 보이며, `square(argc)` 자리에는 `R_X86_64_PLT32 _Z6squarei-0x4` 재배치가 붙은 `call`이 보인다.

5. (실습) `wrap_domain_fail.cpp`를 먼저 그대로 컴파일해 `invalid operands ... to binary 'operator%'` 에러를 재현하라. 그다음 `if`를 `if constexpr`로 바꿔 같은 파일이 통과하는 것을 확인하라. 성공 기준: 수정 전 에러와 수정 후 정상 출력(`104`, `-2.28319` 근처) 둘 다 봤다.
:::

::: answer 해설
1. `const int size = n;`은 컴파일된다 — `const`는 "초기화 이후 안 바뀐다"만 요구하고 초기화 자체는 런타임 값이어도 된다(`const_notenough.cpp`, exit 0). `constexpr int size = n;`은 에러다 — 초기화 식이 상수 표현식이어야 하는데 `n`은 런타임 값이라 자격이 없다(`constexpr_var_fail.cpp`).
2. `constexpr` 함수는 런타임 변수로 호출하면 평범한 런타임 호출로 컴파일된다 — `square(n)`이 그랬다. `consteval` 함수는 그 자리에서 컴파일 에러다 — `consteval_test.cpp`처럼 "런타임으로 물러나기"라는 선택지가 없다.
3. 뼈대: `constexpr int current_to_adc(double amps) { return static_cast<int>((amps + 3.0) / 6.0 * 4095); }`로 짜고 `static_assert`로 `current_to_adc(0.0)`이 중간값 근처인지 검증한다. `main`에서는 `std::cin` 값을 그대로 넘겨 런타임 호출을 확인한다.
4. `kSquared7`을 쓰는 명령은 `mov` 하나뿐이고 앞뒤에 `call`이 없다. `square(argc)` 직전에는 인자 준비 다음 `call ...`이 오고, `R_X86_64_PLT32 _Z6squarei-0x4` 재배치가 붙어 있다 — `square(int)`를 실제로 호출하는 자리다.
5. 수정 전: `wrap_to_range<double>` 인스턴스화 순간 정수 분기도 `T = double`로 컴파일을 시도해 `invalid operands ... to binary 'operator%'`가 뜬다. `if constexpr`로 바꾸면 그 분기가 인스턴스화되지 않아 통과하고 `104`, `-2.28319`가 출력된다.
:::

이 절의 예제 파일을 전부 직접 타이핑하고, `constexpr_asm.cpp`는 반드시 `objdump -d -r`까지 손으로 돌려 `call` 명령이 사라지는 것을 두 눈으로 확인해라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -Wshadow 파일.cpp -o 이름 && ./이름`이고, 어셈블리를 볼 때만 `-O0 -c` 뒤에 `objdump -d -r -M intel 파일.o`를 추가로 쓴다.

**다음 절**: [4.7 auto, decltype, 타입 추론 규칙](#/type-deduction) — `constexpr`가 "값"의 확정이었다면, 이번엔 "타입" 쪽의 확정이다. `auto`가 벗겨내는 것과 남기는 것, `decltype`이 그와 다르게 동작하는 지점, 그리고 `auto&&`가 실제로 무엇을 추론하는지를 실측으로 확인한다.
