# 2.11 댕글링, UB, 새니타이저

::: lead
Part II를 여기까지 오는 동안 "미정의 동작"이라는 말을 이미 여섯 번 넘게 만났다 — 그런데 이 책은 그 말을 한 번도 정면으로 정의한 적이 없다. 늘 "이건 UB다, 자세한 건 나중에"로 미뤄 왔다. 이 절이 그 빚을 갚는다. 표준이 UB를 정확히 뭐라고 규정하는지, 그 규정이 컴파일러의 최적화 결정에 왜 직접 연결되는지를 이 환경에서 실제로 재현한다. 그다음 산발적으로 써 온 `-fsanitize=address`와 `-fsanitize=undefined`를 정식으로 정리한다 — 각각 무엇을 잡고 못 잡는지, 실제로 얼마나 느려지는지, 왜 로봇에 실어 보내면 안 되는지까지.
:::

## 이 책은 이미 UB를 여섯 번 만났다

한 번씩 되짚어 보면 이렇다.

- [1.2 타입 시스템](#/types) — `INT_MAX + 1` signed overflow. `x + 1`이 음수로 찍히면서 `x + 1 > x`가 true인 모순까지 봤다.
- [1.3 변수, 초기화, 스코프](#/variables) — 초기화 안 된 지역 변수 읽기는 "쓰레기값"이 아니라 UB. 같은 바이너리를 세 번 돌려 세 번 다른 값이 나왔다.
- [1.5 제어 흐름과 표현식](#/control-flow) — `i++ + i++`처럼 한 연산자 안에서 같은 변수를 두 번 건드리면 C++20에서도 UB.
- [1.7 배열과 문자열](#/arrays-strings) — `gains[idx]`의 범위 밖 접근은 UB, ASan이 `stack-buffer-overflow`로 잡았다.
- [2.2 포인터](#/pointers) — `nullptr` 역참조와 스코프 종료 후의 댕글링 포인터, 둘 다 UB.
- [2.4 new/delete와 동적 할당의 비용](#/dynamic-alloc) — 이중 해제와 use-after-free가 UB, glibc가 우연히 `Aborted`로 잡아 준 것뿐이었다.

여섯 번 다 "UB니까 위험하다"까지만 말했지, UB가 정확히 무엇의 이름인지는 말한 적이 없다. 지금 정의한다.

## 표준의 네 가지 태도

C++ 표준은 프로그램의 모든 동작을 네 등급 중 하나로 분류한다. 등급이 낮아질수록 "표준이 보장하는 것"이 줄어든다.

| 등급 | 표준의 태도 | 실측/예 |
| --- | --- | --- |
| 정의된 동작 (defined behavior) | 결과를 정확히 못박는다 | unsigned 랩어라운드 — `0u - 1`은 항상 `4294967295`([1.2](#/types)) |
| 미지정 동작 (unspecified behavior) | 여러 결과 중 하나지만 어느 것인지 표준이 안 정하고, 문서화 의무도 없다 | 함수 인자 평가 순서 — `f(i++, i++)`가 g++·clang에서 다르게 나왔다([1.5](#/control-flow)) |
| 구현 정의 동작 (implementation-defined behavior) | 여러 결과 중 하나를 구현이 고르되, **어느 쪽을 골랐는지 문서화해야 한다** | `sizeof(int)` — 이 환경(LP64)은 4([1.2](#/types)), `char`의 부호(x86 signed, ARM unsigned) |
| 미정의 동작 (undefined behavior, UB) | 결과에 **아무 요구도 하지 않는다** | signed 오버플로([1.2](#/types)), 댕글링 포인터 역참조([2.2](#/pointers)) |

미지정과 구현 정의를 가르는 선은 딱 하나다 — **문서화 의무.** `char`의 부호은 매뉴얼에 적어야 하지만 함수 인자의 평가 순서는 적을 필요가 없다. 이 넷 중 진짜 위험한 건 UB 하나뿐이다 — 나머지 셋은 "결과가 여럿 중 하나"일 뿐 프로그램의 의미는 유지되지만, UB는 **프로그램 전체의 의미가 사라진다.**

::: warn "표준 위반이 아니다"라는 말의 무게
UB를 "이 줄이 실행되면 이상한 값이 나온다"로 이해하면 절반만 맞는다. 정확한 뜻은 "표준이 이 상황에서 프로그램이 어떻게 동작해야 하는지 아무 요구도 하지 않는다"다. 그 순간부터 표준의 보호 범위 밖이라, **그 이전 줄과 이후 줄의 의미까지 컴파일러 마음대로 바뀔 수 있다.** 다음 절이 바로 그 증거다.
:::

## 컴파일러는 UB가 없다고 가정하고 최적화한다

여기가 이 절에서 가장 반직관적인 지점이다. 컴파일러는 "이 코드에 UB가 있으면 어떻게든 처리해 준다"가 아니라 정반대로 움직인다 — **UB가 나는 입력은 애초에 들어오지 않는다고 가정하고, 그 가정 위에서 최적화한다.** 오버플로 여부를 검사하려는 흔한 코드로 실측한다.

```cpp title="branch_erase.cpp — 오버플로를 감지하려는 안전 검사"
#include <cstdio>
#include <climits>

__attribute__((noinline))
void check(int x) {
    if (x + 1 > x) {
        printf("  -> 정상 범위로 판정\n");
    } else {
        printf("  -> 오버플로 감지!\n");
    }
}

volatile int g_x = INT_MAX;   // 컴파일 타임에 접히지 않게 volatile로 감춘다

int main() {
    int x = g_x;
    printf("x = %d\n", x);
    check(x);
    return 0;
}
```

`x`가 `INT_MAX`면 `x + 1`은 오버플로해서 하드웨어에서는 `INT_MIN`으로 랩어라운드된다 — 그러니 `x + 1 > x`는 false여야 하고 "오버플로 감지!"가 찍혀야 할 것 같다. 실측은 다르다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 branch_erase.cpp -o be_default
$ ./be_default
x = 2147483647
  -> 정상 범위로 판정
```

`-O0`, `-O1`, `-O3`까지 전부 같은 결과다(g++ 13.3 실측). 디스어셈블을 보면 이유가 명확하다.

```console
$ objdump -d --disassemble=_Z5checki be_default
0000000000001180 <_Z5checki>:
    1180: endbr64
    1184: lea    0xe79(%rip),%rsi     # "정상 범위로 판정" 문자열
    118b: mov    $0x2,%edi
    1190: xor    %eax,%eax
    1192: jmp    __printf_chk@plt
```

`x` 값을 아예 안 본다. 비교(`cmp`)도 분기(`je`/`jne`)도 없다 — **`if`가 통째로 사라지고 "정상 범위로 판정" 쪽으로 직행한다.** 컴파일러가 "`x + 1 > x`는 오버플로가 없다고 가정하면 항상 참"이라고 증명해 버렸다. 오버플로가 UB인 이상 오버플로 나는 입력은 "일어나지 않는 경우"로 취급되고, 남는 경우에서는 이 식이 항상 참이다.

이 가정을 강제로 끄는 스위치가 있다. `-fwrapv`는 컴파일러에게 "signed 오버플로는 2의 보수로 랩어라운드한다고 정의해라"라고 지시한다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -fwrapv branch_erase.cpp -o be_wrapv
$ ./be_wrapv
x = 2147483647
  -> 오버플로 감지!
```

같은 소스, 같은 `-O2`인데 결과가 뒤집혔다. 디스어셈블에도 이번엔 진짜 비교가 있다.

```console
$ objdump -d --disassemble=_Z5checki be_wrapv
0000000000001180 <_Z5checki>:
    1180: endbr64
    1184: cmp    $0x7fffffff,%edi
    118a: je     11a0 <...+0x20>
    ...
```

`-fwrapv`가 무오버플로 가정을 끄니 컴파일러는 실제로 `edi`(=`x`)를 `INT_MAX`와 비교하는 명령을 만들어야 했다. 결론은 하나다. **"오버플로가 나도 검사로 잡으면 된다"는 생각은 성립하지 않는다** — 검사식이 오버플로를 일으키는 연산을 포함하는 순간, 그 검사식 자신이 UB의 가정 아래서 최적화돼 사라질 수 있다. 오버플로는 일어난 **뒤에** 잡는 게 아니라 일어나기 **전에** 범위를 확인해서 막아야 한다.

::: deep 이 가정이 성능 자산인 이유
`-fstrict-overflow`(기본 켜짐)가 없으면 컴파일러는 루프 카운터가 오버플로하지 않는다고 증명할 수 없어 경계 추론, 벡터화, 강도 감소(strength reduction) 같은 최적화를 포기해야 한다. UB로 지정된 덕분에 "오버플로하는 입력은 안 들어온다"고 가정하고 훨씬 공격적으로 최적화한다. 대가는 이 절에서 본 것 그대로다 — 가정이 깨지는 입력이 실제로 들어오면 검사 코드 자체가 증발한다.
:::

## 이 책이 실측한 UB, 한 번에 모은다

| UB 종류 | 실측한 곳 | 새니타이저 진단명 |
| --- | --- | --- |
| 배열 범위 밖 접근 | [1.7 배열과 문자열](#/arrays-strings) | `stack-buffer-overflow` |
| 널 포인터 역참조 | [2.2 포인터](#/pointers) | `load of null pointer` (UBSan) |
| 댕글링 참조/포인터(스코프 종료 후 접근) | [2.2 포인터](#/pointers) | `stack-use-after-scope` |
| 이중 해제 | [2.4 new/delete와 동적 할당의 비용](#/dynamic-alloc) | `double-free` |
| 수명이 끝난 힙 객체 접근 (use-after-free) | [2.4](#/dynamic-alloc) | `heap-use-after-free` |
| 초기화 안 된 값 읽기 | [1.3 변수, 초기화, 스코프](#/variables) | (ASan/UBSan 둘 다 못 잡는다 — 아래에서 다룬다) |
| signed 정수 오버플로 | [1.2 타입 시스템](#/types), 이 절 | `signed integer overflow` (UBSan) |

일곱 항목이 서로 다른 버그처럼 보여도 표준의 눈에는 전부 같은 등급이다 — **결과에 아무 요구도 없는 미정의 동작.** 다음이 이 일곱을 잡는 도구 두 가지다.

## ASan과 UBSan, 정식으로

### 각각 잡는 것, 못 잡는 것

**AddressSanitizer(`-fsanitize=address`)**는 메모리 **접근 범위**를 감시한다. 잡는 것: 힙/스택/전역 버퍼의 범위 밖 접근, use-after-free, use-after-scope, 이중 해제, 일부 메모리 누수 — 위 표의 앞 다섯 줄이 전부 ASan의 영역이다. 못 잡는 것: 접근 자체는 유효한 메모리 안에서 일어나는 버그 — signed 오버플로는 결과가 여전히 `int` 한 칸 안에 있으니 ASan이 볼 이유가 없고, [2.6 복사 시맨틱](#/copy-semantics)의 자기 대입 버그 같은 논리 오류도 감시 범위 밖이다.

**UndefinedBehaviorSanitizer(`-fsanitize=undefined`)**는 반대로 언어 차원의 **연산 규칙 위반**을 감시한다. 잡는 것: signed/unsigned 오버플로, 널 포인터 역참조, 정렬 위반, 0으로 나누기, 잘못된 시프트 폭, 유효하지 않은 enum/bool 캐스팅. 못 잡는 것: 메모리 범위 자체는 관심사가 아니다 — `arr[10]`이 크기 4짜리 배열을 넘어도 인덱스가 컴파일 타임에 안 보이면 UBSan은 조용하다(ASan의 일이다).

두 도구 모두 **초기화 안 된 값 읽기는 못 잡는다.** 그 진단은 MemorySanitizer(MSan)의 몫인데, clang 전용이고 링크되는 모든 코드가 같은 방식으로 계측돼 있어야 해서 g++ 기반 프로젝트에서는 못 쓴다. [1.3](#/variables)에서 미초기화 읽기를 `-Wmaybe-uninitialized` 컴파일 타임 경고로만 잡았던 이유가 이것이다 — 런타임 새니타이저가 이 부류를 놓치는 만큼 정적 분석에 더 의존해야 한다.

### 동시 사용법

서로 다른 계측이라 같은 빌드에 함께 넣을 수 있다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address,undefined main.cpp -o main
```

한 실행에서 두 종류의 버그를 순서대로 잡는 것을 직접 확인한다.

```cpp title="combined.cpp — 서로 다른 버그 두 개"
#include <cstdio>
#include <climits>

int main() {
    int x = INT_MAX;
    int y = x + 1;                 // UBSan: signed overflow
    printf("y = %d\n", y);

    int* arr = new int[4];
    arr[4] = 99;                   // ASan: heap-buffer-overflow
    printf("arr[4] = %d\n", arr[4]);

    delete[] arr;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address,undefined combined.cpp -o combined
$ ./combined
combined.cpp:6:9: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
=================================================================
==6314==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x502000000020 ...
WRITE of size 4 at 0x502000000020 thread T0
    #0 ... in main combined.cpp:10
0x502000000020 is located 0 bytes after 16-byte region [...]
allocated by thread T0 here:
    #0 ... in operator new[](unsigned long) ...
    #1 ... in main combined.cpp:9

SUMMARY: AddressSanitizer: heap-buffer-overflow combined.cpp:10 in main
```

첫 줄은 UBSan이 6번째 줄의 오버플로를 진단하고 지나간 것이다(UBSan은 기본적으로 진단만 찍고 실행을 이어간다). 그 뒤 ASan이 10번째 줄의 힙 범위 밖 쓰기에서 프로세스를 멈춘다. **한 실행 안에 서로 다른 두 등급의 버그가 각자 잡혔다** — `address,undefined`를 같이 켜는 이유다.

### 오버헤드 실측

이만한 진단 능력이 공짜일 리 없다. 2천만 개짜리 `vector`를 열 번 훑는 루프로 재 봤다(3회 측정 평균, g++ 13.3 / `-O2` / Linux x86-64).

| 빌드 | 실행 시간 | 배수 |
| --- | --- | --- |
| 일반 (`-O2`만) | 약 112 ms | 1.0배 |
| ASan (`-fsanitize=address`) | 약 231 ms | 약 2.1배 |
| UBSan (`-fsanitize=undefined`) | 약 345 ms | 약 3.1배 |
| ASan + UBSan | 약 504 ms | 약 4.5배 |

절대값은 이 환경 고유지만 배수는 어디서나 비슷한 자릿수다. 이 워크로드는 배열 인덱싱과 정수 산술이 반복문을 지배해 두 계측의 비용이 두드러진 경우다 — 실제 코드베이스에서는 메모리 접근 밀도에 따라 배수가 더 낮게도, 높게도 나온다. 시간 말고 **메모리 오버헤드**도 있다 — ASan은 할당마다 레드존과 그림자 메모리를 따로 유지해 상주 메모리도 늘어난다.

### 왜 프로덕션에 안 쓰는가

세 가지가 겹친다. 위 배수는 밀리초 단위 로봇 제어 루프에는 그대로 예산 초과다 — [6.8 실시간 제약과 제어 루프](#/realtime)의 지터 얘기와 정면으로 충돌한다. 메모리 오버헤드는 임베디드 보드의 한정된 RAM을 압박한다. 그리고 더 근본적인 문제 — **새니타이저는 버그를 고치지 않고 그 자리에서 프로세스를 죽인다.** 개발 중엔 원하는 동작이지만, 다리를 움직이던 로봇이 그 순간 멈추는 것은 원래 버그보다 나을 게 없다. 그래서 새니타이저는 개발·CI([7.8 CI 파이프라인 구성](#/ci)) 전용이고 배포 빌드에는 넣지 않는다.

## UB를 피하는 습관

**정적 분석을 앞단에 둔다.** 새니타이저는 코드 경로가 실제로 실행돼야 잡는다 — 테스트가 안 지나간 경로의 UB는 못 본다. 실행 없이 의심 패턴을 잡는 정적 분석기가 이 구멍을 메운다. `clang-tidy`는 [7.7 clang-tidy와 정적 분석](#/static-analysis)에서 본격적으로 다룬다.

**테스트는 항상 새니타이저 빌드로 돌린다.** 일반 빌드 통과가 안전하다는 뜻이 아니다 — UB는 "우연히 멀쩡해 보이는" 결과를 자주 낸다. CMake 프리셋에 `-fsanitize=address,undefined`를 켠 디버그 구성을 따로 두고, 로컬 테스트와 CI 둘 다 그 구성으로 돌리는 것이 관례다.

**경고를 에러로 취급한다.** `-Wall -Wextra`가 잡아 주는 UB의 전조(미초기화 사용, 댕글링 포인터, 부호 비교 경고)를 팀 전체가 무시하지 않게 만드는 유일한 방법이 `-Werror`다. 경고 하나를 빌드 실패로 만들면 "나중에 고치겠다"는 선택지가 없어진다 — [0.3](#/first-build)의 "경고 0개" 기준이 여기서 완성된다.

## 왜 로봇 코드에서 UB가 유독 위험한가

UB의 가장 나쁜 성질은 "안 보인다"가 아니라 **"보이는지 여부가 빌드 설정에 달렸다"**는 것이다. 분기 하나에서만 초기화되는 지역 변수를 반환하는 함수로 실측한다.

```cpp title="uninit_fold.cpp"
#include <cstdio>

__attribute__((noinline))
int compute(int mode) {
    int result;
    if (mode == 1) {
        result = 42;
    }
    return result;   // mode != 1 이면 result는 미초기화
}

volatile int g_mode = 2;

int main() {
    int mode = g_mode;
    printf("mode = %d\n", mode);
    printf("compute(mode) = %d\n", compute(mode));
    return 0;
}
```

`mode`가 2로 들어오니 `if` 안쪽은 실행되지 않고, `result`는 초기화된 적 없이 반환된다 — UB다. 최적화 레벨별로 돌려 본다(g++ 13.3 실측).

```console
$ g++ -std=c++20 -Wall -Wextra -O0 uninit_fold.cpp -o uf_O0 && ./uf_O0
mode = 2
compute(mode) = 0

$ g++ -std=c++20 -Wall -Wextra -O2 uninit_fold.cpp -o uf_O2 && ./uf_O2
mode = 2
compute(mode) = 42
```

`-O0`은 0을 냈고 `-O2`는 42를 냈다 — **입력이 완전히 같은데 컴파일 옵션 하나로 결과가 뒤집혔다.** 디스어셈블을 보면 `-O2`에서 무슨 일이 났는지 드러난다.

```console
$ objdump -d --disassemble=_Z7computei uf_O2
0000000000001190 <_Z7computei>:
    1190: endbr64
    1194: mov    $0x2a,%eax        # 0x2a = 42
    1199: ret
```

`compute` 함수 전체가 `mov $42, %eax; ret`로 줄었다 — **`mode` 파라미터를 아예 안 본다.** `mode != 1`인 경로는 미초기화 변수를 읽는 UB이므로 컴파일러가 "일어나지 않는 경우"로 접어 버렸고, 남는 유일한 경우(`mode == 1`)의 값 42를 무조건 반환하게 함수를 통째로 재작성했다.

함의는 직접적이다. 개발 중엔 `colcon build`를 디버그 설정(`-O0`, 새니타이저 켜짐, gdb 세션)으로 자주 돌리고, 배포 빌드는 관례상 `-O2`(Release)다. **똑같은 UB가 두 빌드에서 다른 값을 낸다면, 개발자의 노트북에서 한 번도 못 본 증상이 필드의 로봇에서만 재현되는 버그가 된다.** 헥사포드 같은 실제 로봇은 대개 개발 워크스테이션(x86-64)과 다른 아키텍처(ARM SBC)에서 최종 실행되므로, 코드 생성 결정 자체가 또 달라져 재현성이 더 떨어진다. **"내 컴퓨터에서는 잘 돌아간다"가 UB 앞에서는 증명이 아니다.**

::: interview 미정의 동작이 뭐고 왜 위험한가
답변 뼈대: ① UB는 표준이 "이 상황에서 프로그램이 어떻게 동작해야 하는지 아무 요구도 하지 않는다"고 선언한 영역이다 — 크래시·이상한 값·겉보기 정상, 전부 합법이다. ② 컴파일러는 "UB가 나는 입력은 안 들어온다"고 가정하고 최적화하므로, UB를 밟는 순간 앞뒤 코드의 의미까지 바뀔 수 있다(이 절의 오버플로 검사 소멸, 미초기화 변수로 인한 분기 통째 삭제가 증거). ③ **미지정(unspecified)**은 결과가 여럿 중 하나지만 구현이 그 선택을 문서화할 의무가 없는 것(함수 인자 평가 순서), **구현 정의(implementation-defined)**는 마찬가지로 여럿 중 하나지만 구현이 반드시 문서화해야 하는 것(`sizeof(int)`)이다 — 셋 다 "결과가 여럿 중 하나"인 건 같지만, UB만 프로그램 전체의 의미를 무너뜨린다. ④ 실무 대응은 정적 분석(clang-tidy)으로 실행 전에 패턴을 잡고, ASan/UBSan으로 테스트 실행 중에 잡되, 오버헤드 때문에 배포 빌드엔 넣지 않는다는 것까지 말하면 상급이다.
:::

## 요약

- 표준은 프로그램의 동작을 네 등급으로 나눈다 — 정의됨(unsigned 랩어라운드), 미지정(함수 인자 순서, 문서화 의무 없음), 구현 정의(`sizeof(int)`, 문서화 의무 있음), 미정의(UB, 아무 요구도 없음). 위험한 것은 UB 하나뿐이다.
- 컴파일러는 UB가 나는 입력이 없다고 가정하고 최적화한다 — 실측: `x + 1 > x` 오버플로 검사가 `-O0`부터 이미 통째로 사라져 `if` 없는 코드가 됐다(`-fwrapv`로 가정을 끄면 되살아난다).
- 이 책이 실측한 UB 일곱 가지(배열 범위 밖, 널 역참조, 댕글링, 이중 해제, use-after-free, 미초기화 읽기, signed 오버플로)를 한 표로 모았다 — 미초기화 읽기만 ASan/UBSan 둘 다 못 잡는다.
- ASan은 메모리 **범위**를, UBSan은 **연산 규칙**을 감시한다 — 서로 겹치지 않아 `-fsanitize=address,undefined`로 같이 켤 수 있고, 실측에서 한 실행 안에 서로 다른 두 버그를 각자 잡는 것을 확인했다.
- 오버헤드 실측: ASan 약 2.1배, UBSan 약 3.1배, 둘 다 약 4.5배 — 이 배수와 프로세스 강제 종료라는 특성 때문에 새니타이저는 개발·CI 전용이지 배포 빌드에 넣지 않는다.
- 같은 UB가 `-O0`과 `-O2`에서 다른 값을 낸다는 것을 직접 실측했다(0 vs 42) — 개발 빌드에서 안 보이던 버그가 최적화된 배포 빌드에서만, 심지어 다른 아키텍처에서만 터지는 이유다.

::: quiz 연습문제
1~2번은 개념·분류 문제, 3~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. 다음을 정의됨/미지정/구현 정의/미정의 중 하나로 분류하고 근거를 한 문장씩 써라. ① `long`의 크기가 Linux(LP64)와 Windows(LLP64)에서 다른 것 ② `unsigned int u = 0; u - 1;`의 결과 ③ `int* p; *p;`(초기화 안 된 포인터 역참조).
2. `branch_erase.cpp`를 `-fwrapv` 없이 컴파일하면 `if (x + 1 > x)`가 항상 참으로 접힌다. 이 최적화가 성립하려면 컴파일러가 어떤 가정을 세워야 하는지, 그 가정이 왜 "오버플로 이후에 검사하는" 방어 코드를 무력화하는지 설명하라.
3. (실습) `uninit_fold.cpp`를 쳐서 `-O0`과 `-O2`로 각각 빌드·실행하라. `objdump -d --disassemble=_Z7computei`로 `-O2` 결과물을 디스어셈블해 `mode` 파라미터가 실제로 쓰이는지 확인하라. 성공 기준: 두 빌드의 출력이 다르고, `-O2` 어셈블리에 `mode`(`%edi`)를 읽는 명령이 없다.
4. (실습) 한 함수 안에 signed 오버플로(`INT_MAX + 1`)와 힙 버퍼 오버플로(`new int[4]` 뒤 `arr[4]` 쓰기)를 순서대로 넣은 프로그램을 작성해 `-fsanitize=address,undefined`로 빌드·실행하라. 성공 기준: 출력에서 UBSan의 `runtime error: signed integer overflow`와 ASan의 `heap-buffer-overflow` `SUMMARY`가 한 실행 안에서 순서대로 나온다.
5. `-fsanitize=address,undefined`를 배포되는 로봇 바이너리에 상시로 켜두지 않는 이유를 이 절의 실측 두 가지(오버헤드, 프로세스 종료 방식)로 설명하라.
:::

::: answer 해설
1. ① 구현 정의 — 값 하나를 구현이 고르되 ABI 문서에 반드시 명시한다. ② 정의됨 — unsigned 랩어라운드는 모듈로 $2^N$으로 못박혀 있어 결과가 항상 `4294967295`다. ③ 미정의 — 초기화 안 된 포인터가 어떤 주소를 담고 있을지, 그 역참조 결과가 무엇일지 표준이 전혀 보장하지 않는다.
2. 가정: "signed 정수 연산은 오버플로하지 않는다." 이 가정 아래 `x + 1 > x`는 모든 `x`에 항상 참이므로 컴파일러가 상수 `true`로 접을 수 있다. 방어 코드가 무력화되는 이유는, 지키려던 연산(`x + 1`) 자체가 오버플로하는 순간 UB라서 검사식이 그 무오버플로 가정 위에서 다시 쓰이기 때문이다 — 검사 대상이 UB면 검사 자체도 그 가정을 상속받는다.
3. 실측 기준값: `-O0`은 `compute(2)`가 `0`(우연히 남은 스택 값), `-O2`는 `42`(컴파일러가 `mode == 1` 경로만 유효하다고 가정하고 함수를 재작성)다. `objdump`에는 `mov $0x2a,%eax` / `ret` 두 명령뿐이고 `edi`(`mode`)를 읽는 명령이 없다.
4. UBSan 줄은 `INT_MAX + 1` 계산 줄에서, ASan `SUMMARY` 줄은 범위 밖 쓰기가 일어난 줄에서 난다(정확한 번호는 작성한 코드에 따라 다르다). 순서는 실행 순서를 따른다 — UBSan은 진단 후 실행을 계속하고, ASan은 감지 즉시 프로세스를 중단하기 때문에 UBSan 줄이 먼저 찍힌다.
5. 오버헤드: 이 절의 벤치마크에서 일반 빌드 대비 ASan 약 2.1배, UBSan 약 3.1배, 둘 다 약 4.5배 느려졌다 — 로봇 제어 주기의 시간 예산을 그대로 초과한다. 종료 방식: 새니타이저는 버그를 감지하면 그 자리에서 프로세스를 중단시킨다 — 움직이던 로봇이 제어 루프 도중 그렇게 멈추는 것은 원래 버그보다 나은 결과가 아니다.
:::

이 절의 코드는 전부 직접 쳐라. `branch_erase.cpp`는 기본 빌드와 `-fwrapv` 빌드를 나란히 돌려 "같은 소스, 다른 결과"를 보고, `uninit_fold.cpp`는 `-O0`과 `-O2`를 나란히 돌린 뒤 반드시 `objdump -d`로 `-O2` 어셈블리까지 확인하라 — 명령어가 파라미터를 무시하는 것을 직접 보기 전까지는 "우연이겠거니"로 넘기기 쉽다. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -O2 main.cpp -o main && ./main`, 새니타이저는 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address,undefined main.cpp -o main && ./main`, 디스어셈블은 `objdump -d --disassemble=<맹글된이름> ./main`(`nm ./main | grep <함수이름>`으로 찾는다).

**다음 절**: [2.12 객체 메모리 레이아웃과 정렬](#/object-layout) — UB를 낳는 마지막 큰 원천, 정렬(alignment) 위반과 패딩이다. `sizeof`가 멤버 합보다 큰 수를 내는 이유, 그리고 그 여백이 왜 존재하는지를 정면으로 연다.
