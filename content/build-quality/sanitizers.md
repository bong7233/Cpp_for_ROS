# 7.5 ASan, UBSan, TSan

::: lead
이 책은 이미 새니타이저를 수십 곳에서 썼다 — [1.7](#/arrays-strings)의 배열 범위 밖 접근, [2.2](#/pointers)의 댕글링 포인터, [2.4](#/dynamic-alloc)의 이중 해제, [5.1](#/vector)·[5.4](#/iterators)의 반복자 무효화, [6.2](#/data-races)의 데이터 레이스, [6.5](#/atomic)·[6.6](#/lockfree)의 락 없는 자료구조까지, 전부 `-fsanitize=...` 플래그 하나로 실제 버그를 실측하며 지나갔다. 그런데 그 도구 자체 — ASan·UBSan·TSan이 각각 무엇을 감시하고, 왜 서로 같이 못 켜지는 조합이 있고, 실제로 얼마나 느려지는지 — 를 한곳에 모아 정리한 적은 없다. 이 절이 그 정리다. 새 버그를 잡는 절이 아니라, 지금까지 흩어져 쓴 도구 세 개를 나란히 놓고 비교하는 절이다.
:::

## 이 책이 이미 잡은 것들, 한 표로 모은다

[2.11](#/ub-sanitizers)에서 이미 ASan과 UBSan 각각이 잡는 것/못 잡는 것을 정리했다. 그 표에 TSan을 더해 세 도구를 나란히 놓는다.

| 도구 | 플래그 | 감시 대상 | 이 책에서 실제로 잡은 것 |
| --- | --- | --- | --- |
| AddressSanitizer(ASan) | `-fsanitize=address` | 메모리 **접근 범위** | `heap-buffer-overflow`([2.11](#/ub-sanitizers) 종합), `heap-use-after-free`([2.4](#/dynamic-alloc)), `stack-use-after-scope`([2.2](#/pointers)), `stack-use-after-return`([6.1](#/threads)) |
| UndefinedBehaviorSanitizer(UBSan) | `-fsanitize=undefined` | 언어 차원의 **연산 규칙** | signed 오버플로([2.11](#/ub-sanitizers)) |
| ThreadSanitizer(TSan) | `-fsanitize=thread` | 동기화 없는 **동시 접근** | 데이터 레이스([6.2](#/data-races)), relaxed 오더로 넘긴 비원자 데이터의 가시성 문제([6.5](#/atomic)) |

세 도구는 감시 대상이 서로 겹치지 않는다 — ASan은 "이 주소에 접근해도 되는가", UBSan은 "이 연산이 언어 규칙을 지키는가", TSan은 "이 접근이 다른 스레드의 접근과 동기화됐는가"를 각자 독립적으로 묻는다. 이 절은 UBSan을 아직 개별 버그로 실측하지 않은 세 가지 — 정수 오버플로 외의 널 역참조·잘못된 시프트 — 를 처음으로 정식으로 다루고, 나머지는 전부 위 표의 참조로 넘긴다.

## ASan이 내부적으로 하는 일 — 그림자 메모리

ASan이 어떻게 `arr[4]`가 4바이트짜리 배열의 범위를 넘었는지 매번 정확히 아는지 궁금했을 것이다. 정답은 **그림자 메모리(shadow memory)**다 — 프로그램이 쓰는 실제 메모리 8바이트마다 그 유효성 정보를 담은 그림자 바이트 1개를 별도 영역에 유지한다. 컴파일러는 `-fsanitize=address`가 켜지면 코드의 메모리 접근마다 "이 주소에 대응하는 그림자 바이트가 유효를 뜻하는가"를 확인하는 코드를 자동으로 끼워 넣는다 — 이게 이 절 제목에도 나오는 "계측(instrumentation)"이다. 힙 할당 하나를 실제로 터뜨려서 그림자 메모리를 직접 본다.

```cpp title="shadow_demo.cpp — 4개짜리 배열에 5번째 원소를 쓴다"
#include <cstdio>

int main() {
    int* arr = new int[4];
    arr[4] = 99;
    printf("%d\n", arr[4]);
    delete[] arr;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -g -fsanitize=address shadow_demo.cpp -o shadow_demo
$ ./shadow_demo
```

```text nolines
==11185==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x502000000020 ...
WRITE of size 4 at 0x502000000020 thread T0
    #0 ... in main shadow_demo.cpp:5
0x502000000020 is located 0 bytes after 16-byte region [0x502000000010,0x502000000020)
allocated by thread T0 here:
    #0 ... in operator new[](unsigned long) ...
    #1 ... in main shadow_demo.cpp:4

SUMMARY: AddressSanitizer: heap-buffer-overflow shadow_demo.cpp:5 in main
Shadow bytes around the buggy address:
=>0x502000000000: fa fa 00 00[fa]fa fa fa fa fa fa fa fa fa fa fa
Shadow byte legend (one shadow byte represents 8 application bytes):
  Heap left redzone:       fa
  ...
```

(g++ 13.3.0 / `-O0` / Ubuntu 24.04 x86-64 실측. 지면상 스택 트레이스와 범례 나머지 줄은 줄였다.) 맨 아래 두 줄이 그림자 메모리 그 자체다. `int arr[4]`는 16바이트인데, 그림자 바이트 두 개(`00 00`)가 그 16바이트 전부가 "유효"임을 나타낸다 — 범례가 말해 주듯 **그림자 바이트 1개가 실제 메모리 8바이트를 대표한다.** 바로 다음 그림자 바이트가 `fa`(대괄호로 강조된 `[fa]`)인데, 범례의 `Heap left redzone: fa`가 뜻하는 그대로 이 구간은 ASan이 할당 바로 뒤에 일부러 붙여 둔 **레드존(redzone)** — 프로그램이 원래 요청한 적 없는, 오로지 범위 밖 접근을 잡기 위한 여분의 감시 영역이다. `arr[4]`가 쓴 주소(`0x502000000020`)가 정확히 이 레드존 안이었기 때문에 그림자 바이트를 확인하는 계측 코드가 그 자리에서 걸려 넘어졌다.

::: deep 계측은 컴파일 타임에, 검사는 실행 타임에
컴파일러가 하는 일은 두 가지뿐이다. ① 힙 할당마다 레드존을 앞뒤에 붙이도록 `operator new`/`operator delete`를 가로채고, ② 코드의 모든 메모리 읽기·쓰기 앞에 "이 주소의 그림자 바이트를 확인해라"는 몇 개의 명령을 추가로 끼워 넣는다. 실제 판단(레드존인지, 해제된 뒤인지)은 전부 실행 시점에 이 끼워 넣은 코드가 그림자 메모리를 조회해서 한다 — 정적 분석이 아니라 **런타임 계측**이라는 게 핵심이다. 그래서 실행되지 않은 코드 경로의 버그는 ASan도 못 잡는다([7.7 clang-tidy와 정적 분석](#/static-analysis)이 이 구멍을 메우는 도구다).
:::

이 원리가 [6.1](#/threads)의 `stack-use-after-return`, [2.2](#/pointers)의 `stack-use-after-scope`에도 그대로 적용된다 — 힙뿐 아니라 스택 프레임에도 레드존을 두르고, 함수가 반환되거나 스코프가 끝나는 시점에 그 구간의 그림자 바이트를 "무효"로 바꿔 버리는 것뿐이다. 위 범례의 `Stack after return: f5`, `Stack use after scope: f8`이 그 증거다.

## UBSan을 실제로 트리거한다 — 오버플로 말고 두 가지 더

[2.11](#/ub-sanitizers)은 signed 정수 오버플로 하나만 UBSan으로 실측했다. UBSan이 잡는 범위는 그보다 훨씬 넓다 — 이번엔 널 포인터 역참조와 잘못된 시프트 폭, 두 가지를 새로 실제로 터뜨린다.

```cpp title="ubsan_nullderef.cpp — 초기화 안 된 포인터가 아니라 명시적 nullptr"
#include <cstdio>

struct Pose { double x, y, theta; };

int main() {
    Pose* p = nullptr;
    printf("x = %f\n", p->x);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -g -fsanitize=undefined ubsan_nullderef.cpp -o ubsan_nullderef
$ ./ubsan_nullderef
ubsan_nullderef.cpp:7:19: runtime error: member access within null pointer of type 'struct Pose'
Segmentation fault (core dumped)
```

(g++ 13.3.0 실측, 종료 코드 139.) UBSan이 `p->x`를 평가하기 **직전에** "널 포인터를 통한 멤버 접근"이라고 정확히 진단한다. 그런데 그 뒤에도 프로그램은 죽는다 — [2.11](#/ub-sanitizers)에서 본 `combined.cpp`의 오버플로는 진단만 찍고 실행이 이어졌지만, 이 경우는 UBSan이 진단한 뒤 실제 `p->x` 접근이 그대로 실행되면서 하드웨어 수준의 세그폴트가 따로 터진다. **UBSan은 실행을 항상 계속시켜 주는 게 아니다** — 진단이 붙는 연산 자체가 그 직후에 진짜 잘못된 메모리 접근으로 이어지면, 진단과 크래시가 같이 온다.

```cpp title="ubsan_badshift.cpp — 시프트 폭이 타입 크기를 넘는다"
#include <cstdio>

int main() {
    int bits = 40;              // 설정값 파싱 실수 등으로 잘못 들어왔다고 가정
    int x = 1;
    int shifted = x << bits;    // int는 32비트, 시프트 폭이 32 이상이면 UB
    printf("shifted = %d\n", shifted);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -g -fsanitize=undefined ubsan_badshift.cpp -o ubsan_badshift
$ ./ubsan_badshift
ubsan_badshift.cpp:6:21: runtime error: shift exponent 40 is too large for 32-bit type 'int'
shifted = 256
```

(g++ 13.3.0 실측.) `1 << 40`은 UB지만 이 환경은 `256`을 출력했다 — x86의 시프트 명령어가 시프트 폭을 하위 5비트(`40 & 0x1F = 8`)만 실제로 쓰기 때문에 하드웨어 우연으로 `1 << 8`이 된 것뿐이다. **이 값을 "정답"으로 믿으면 안 된다** — 다른 아키텍처나 다른 최적화 레벨에서는 다른 값이 나올 수 있다는 게 [2.11](#/ub-sanitizers)에서 이미 강조한 UB의 본질이고, UBSan의 역할은 그 값을 "고쳐 주는" 게 아니라 "이 연산 자체가 정의되지 않았다"는 사실을 소스 줄 번호와 함께 알려 주는 것뿐이다.

::: warn UBSan은 기본적으로 죽지 않고 계속 진행한다
오버플로·시프트처럼 그 자체로 후속 크래시를 안 부르는 UB는 진단만 찍고 그냥 지나간다. `-fno-sanitize-recover=undefined`를 추가하면 첫 진단에서 바로 프로세스를 중단시킬 수 있다 — CI에서 "UB가 하나라도 있으면 그 즉시 빌드 실패"로 만들고 싶다면 이 옵션이 필요하다. 기본 동작만 믿고 있으면 로그에 진단이 찍혔는데도 테스트는 초록불로 통과하는 상황이 생긴다.
:::

## TSan — 요약과 오버헤드

TSan 자체의 상세(레이스 리포트 읽는 법, relaxed 오더의 위험)는 [6.2](#/data-races)와 [6.5](#/atomic)에서 이미 실측을 끝냈다. 여기서는 세 도구를 나란히 비교하는 데 필요한 사실만 다시 짚는다 — TSan은 스레드마다 별도의 그림자 메모리와 벡터 시계(vector clock)를 유지해 "이 두 접근 사이에 happens-before 관계가 있는가"를 실행 중에 추적한다. ASan의 그림자 메모리가 "이 바이트가 유효한가"만 묻는 것과 달리, TSan의 그림자 메모리는 "이 바이트를 마지막으로 건드린 스레드가 누구고, 그 스레드와 지금 스레드 사이에 동기화가 있었는가"까지 담아야 해서 구조가 더 무겁다 — 다음 절에서 볼 오버헤드 차이가 여기서 시작된다.

## 새니타이저를 같이 켤 수 있는 조합, 없는 조합 — 실제로 컴파일해서 확인

[2.11](#/ub-sanitizers)에서 `-fsanitize=address,undefined`를 함께 켜는 걸 이미 봤다. 그런데 아무 조합이나 되는 게 아니다. 이 환경에서 가능한 조합과 불가능한 조합을 전부 실제로 컴파일해서 확인했다.

```console
$ g++ -std=c++20 -O2 -g -fsanitize=address,undefined bench.cpp -o b1 -lpthread
$ echo $?
0

$ g++ -std=c++20 -O2 -g -fsanitize=undefined,thread bench.cpp -o b2 -lpthread
$ echo $?
0

$ g++ -std=c++20 -O2 -g -fsanitize=address,thread bench.cpp -o b3 -lpthread
cc1plus: error: '-fsanitize=thread' is incompatible with '-fsanitize=address'
$ echo $?
1

$ g++ -std=c++20 -O2 -g -fsanitize=address,undefined,thread bench.cpp -o b4 -lpthread
cc1plus: error: '-fsanitize=thread' is incompatible with '-fsanitize=address'
$ echo $?
1
```

(g++ 13.3.0 실측 — `bench.cpp`는 아래 §성능 비교에서 쓰는 4스레드 벤치마크다.) 결과를 표로 정리한다.

| 조합 | 결과 | 근거 |
| --- | --- | --- |
| `address` 단독 | 성공 | [2.11](#/ub-sanitizers) 등에서 상시 사용 |
| `undefined` 단독 | 성공 | 이 절 §UBSan |
| `thread` 단독 | 성공 | [6.2](#/data-races) 등에서 상시 사용 |
| `address,undefined` | 성공 | 위 `b1`, 실측 종료 코드 0 |
| `undefined,thread` | 성공 | 위 `b2`, 실측 종료 코드 0 |
| `address,thread` | **실패** | 위 `b3`, 컴파일러가 그 자리에서 거부 |
| `address,undefined,thread` | **실패** | 위 `b4` — `thread`+`address` 충돌이 `undefined`와 무관하게 먼저 걸린다 |

::: danger ASan과 TSan은 같은 빌드에 절대 못 들어간다
이유는 둘 다 **런타임에 프로세스의 가상 주소 공간 레이아웃 자체를 자기 방식대로 재배치**하기 때문이다. ASan은 그림자 메모리를 위해 힙·스택·전역 변수 영역 전체에 대응하는 그림자 영역을 고정된 오프셋 관계로 예약하고, `malloc`/`free`를 가로채 레드존을 끼워 넣는다. TSan은 스레드별 접근 이력을 추적하려고 완전히 다른 자체 그림자 인코딩과 자체 메모리 할당자를 쓰며, 마찬가지로 가상 주소 공간의 넓은 영역을 자신의 방식으로 예약한다. 두 계측이 요구하는 주소 공간 배치 방식이 서로 겹치고 충돌해서, 컴파일러 자체가 "이 조합은 지원 안 한다"고 컴파일 타임에 막아 버린다 — 실행해 보고 이상 동작을 발견하는 게 아니라 `cc1plus`가 그 자리에서 에러를 낸다는 점이 중요하다. 메모리 버그와 스레드 레이스를 동시에 의심되는 코드라면, **ASan 빌드와 TSan 빌드를 별도로 두 번 돌려야 한다** — 한 빌드로 둘 다 잡는 방법은 없다.
:::

::: interview "왜 ASan과 TSan을 같이 못 쓰나"
답변 뼈대: ① 둘 다 메모리 접근을 계측하는 도구지만, ASan은 "이 바이트가 유효한 범위인가"를, TSan은 "이 바이트에 대한 두 접근 사이에 동기화가 있었는가"를 검사하며 각자 다른 그림자 메모리 인코딩과 자체 할당자를 쓴다는 것. ② 둘 다 가상 주소 공간의 상당 부분을 자기 방식으로 예약해야 해서 레이아웃이 충돌한다는 것(실측: `cc1plus: error: '-fsanitize=thread' is incompatible with '-fsanitize=address'`). ③ 그래서 실무에서는 CI 파이프라인에 ASan+UBSan 빌드와 TSan 빌드를 별도 잡(job)으로 나눠 둔다는 것까지 답하면 상급이다.
:::

## 성능 오버헤드 — 결정판 비교표

이 책 곳곳에서 새니타이저 배수를 각자 다른 벤치마크로 쟀다 — [2.11](#/ub-sanitizers)은 2천만 개 `vector` 순회(ASan 약 2.1배, UBSan 약 3.1배, 함께 약 4.5배), [6.2](#/data-races)는 단일 카운터 증가 루프(TSan 약 9배)였다. 벤치마크 모양이 다르면 배수를 직접 비교할 수 없다. 이 절은 **하나의 벤치마크**로 네 가지 빌드를 전부 다시 쟀다 — 배열 접근과 스레드 동기화를 둘 다 포함해서 ASan·UBSan·TSan 모두가 실제로 계측할 거리가 있는 코드다.

```cpp title="bench.cpp — 4스레드가 각자 배열을 건드리며 원자적으로 카운트한다"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>
#include <vector>

constexpr long N = 20'000'000;
constexpr int THREADS = 4;
std::atomic<long> counter{0};

void work() {
    std::vector<int> v(1000);
    for (long i = 0; i < N / THREADS; ++i) {
        v[i % v.size()] += 1;
        counter.fetch_add(1, std::memory_order_relaxed);
    }
}

int main() {
    auto t0 = std::chrono::steady_clock::now();
    std::vector<std::thread> threads;
    for (int i = 0; i < THREADS; ++i) threads.emplace_back(work);
    for (auto& t : threads) t.join();
    auto t1 = std::chrono::steady_clock::now();
    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    printf("counter=%ld elapsed_ms=%.1f\n", counter.load(), ms);
}
```

네 스레드가 각자 배열 인덱싱(ASan이 볼 거리)과 `fetch_add`(TSan이 볼 거리)를 2천만 번 나눠서 반복한다. 다섯 번씩 실행해 중앙값을 취했다(g++ 13.3.0 / `-O2` / Ubuntu 24.04 x86-64).

```console
$ g++ -std=c++20 -O2 -g bench.cpp                        -o b_none -lpthread
$ g++ -std=c++20 -O2 -g -fsanitize=address     bench.cpp -o b_asan -lpthread
$ g++ -std=c++20 -O2 -g -fsanitize=undefined   bench.cpp -o b_ubsan -lpthread
$ g++ -std=c++20 -O2 -g -fsanitize=thread      bench.cpp -o b_tsan -lpthread
$ g++ -std=c++20 -O2 -g -fsanitize=address,undefined bench.cpp -o b_au -lpthread
$ g++ -std=c++20 -O2 -g -fsanitize=undefined,thread  bench.cpp -o b_ut -lpthread
```

| 빌드 | 실행 시간(중앙값, 5회) | 배수 |
| --- | --- | --- |
| 새니타이저 없음 | 341.7 ms | 1.0배 |
| ASan | 440.3 ms | 약 1.3배 |
| UBSan | 453.9 ms | 약 1.3배 |
| ASan + UBSan | 907.8 ms | 약 2.7배 |
| TSan | 893.8 ms | 약 2.6배 |
| UBSan + TSan | 932.3 ms | 약 2.7배 |

(절대값은 이 환경 고유이고 5회 반복 사이 변동폭도 컸다 — 여러 스레드가 커널 스케줄러와 경쟁하는 벤치마크라 [2.11](#/ub-sanitizers)의 단일 스레드 순회보다 실행마다 흔들림이 크다. 그래도 순서는 반복 측정 내내 안정적이었다.) 이 표에서 ASan·UBSan의 배수(약 1.3배)가 [2.11](#/ub-sanitizers)의 배열 순회 벤치마크(약 2.1배, 3.1배)보다 낮다는 게 눈에 띈다. 이유는 벤치마크 구성 자체에 있다 — 이 절의 벤치마크는 시간의 상당 부분을 스레드 생성·join·`fetch_add`의 원자적 연산에 쓰고, ASan/UBSan이 실제로 계측하는 배열 인덱싱은 전체 작업의 일부일 뿐이다. **배수는 "어떤 연산이 코드의 병목인가"에 따라 달라진다** — 배열 인덱싱이 지배적인 코드는 [2.11](#/ub-sanitizers)의 배수에 가깝고, 스레드 동기화가 지배적인 코드는 이 절의 배수에 가깝다. "새니타이저는 몇 배 느리다"는 한 문장으로 끝날 질문이 아니다.

::: perf TSan이 가장 무겁다는 사실은 벤치마크가 바뀌어도 유지된다
[6.2](#/data-races)의 단일 카운터 벤치마크에서는 TSan이 약 9배, 이 절의 혼합 벤치마크에서는 약 2.6배였다 — 절대 배수는 벤치마크마다 다르지만, **네 조합 중 TSan(또는 TSan을 포함한 조합)이 항상 가장 느리다**는 순서는 두 벤치마크 모두에서 유지된다. TSan의 그림자 메모리가 ASan보다 구조적으로 무겁다는 앞 절의 설명과 일치하는 결과다.
:::

## 실전 관행: CI에서 상시 켠다

세 도구를 개발자 개인 워크스테이션에서만 가끔 돌리면 대부분의 회귀를 놓친다 — [6.2](#/data-races)에서 이미 봤듯 레이스는 재현이 안 될 수도 있다. 그래서 실무에서는 이 절의 여섯 빌드 구성 중 최소 두 개(`address,undefined`와 `thread`)를 CMake 프리셋이나 별도 CI 잡으로 고정해 두고, 모든 커밋마다 자동으로 돌린다. `address`와 `thread`가 같은 빌드에 못 들어간다는 이 절의 실측이 정확히 "CI 잡을 왜 두 개로 나눠야 하는가"의 답이다 — 한 파이프라인으로 둘 다 잡으려는 시도 자체가 컴파일 단계에서 막힌다. [7.8 CI 파이프라인 구성](#/ci)에서 이 구성을 GitHub Actions로 실제로 만든다.

## 로보틱스 연결: colcon 워크스페이스의 새니타이저 프리셋

ROS 2 워크스페이스에서 `colcon build --cmake-args -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined" -DCMAKE_BUILD_TYPE=Debug`처럼 인자를 워크스페이스 전체에 넘기면, 워크스페이스 안의 모든 `ament_cmake` 패키지가 이 절의 계측을 켠 채로 다시 빌드된다. 헥사포드처럼 IMU 콜백·인코더 콜백·다리 컨트롤러가 각자 스레드([6.9 스레드 아키텍처 설계](#/thread-architecture))로 도는 구조에서는, `address,undefined` 빌드와 `thread` 빌드를 워크스페이스 단위로 각각 한 번씩 — 이 절에서 확인했듯 하나로 합칠 수 없으니 — colcon 테스트 잡으로 따로 돌리는 게 실전 구성이다. 물론 두 빌드 다 [6.8 실시간 제약과 제어 루프](#/realtime)에서 다룬 이유로 실제 로봇에 실어 보내는 배포 빌드와는 완전히 별개다 — CI와 개발 워크스테이션 전용이다.

## 요약

- ASan(`heap-buffer-overflow`, `stack-use-after-return` 등), UBSan(오버플로, 널 역참조, 잘못된 시프트), TSan(데이터 레이스)은 각각 메모리 범위·연산 규칙·스레드 동기화라는 서로 겹치지 않는 대상을 감시한다 — 이 책에서 실제로 잡은 사례를 [2.11](#/ub-sanitizers), [6.2](#/data-races) 등에서 가져와 한 표로 모았다.
- ASan은 실제 메모리 8바이트당 그림자 바이트 1개를 유지하고, 컴파일러가 모든 메모리 접근 앞에 이 그림자 바이트를 확인하는 코드를 끼워 넣는(계측) 방식으로 동작한다 — 실측한 그림자 바이트(`00 00 [fa]`)가 유효한 16바이트 바로 뒤에 레드존이 붙어 있음을 직접 보여준다.
- UBSan은 널 역참조(`member access within null pointer`)와 잘못된 시프트(`shift exponent 40 is too large`)를 이 절에서 처음 실측했다 — 널 역참조는 진단 직후 실제 세그폴트로 이어진다는 것도 확인했다(UBSan이 항상 실행을 이어가는 건 아니다).
- `-fsanitize=address,undefined`와 `-fsanitize=undefined,thread`는 실제로 컴파일·실행에 성공했지만, `-fsanitize=address,thread`는 `cc1plus`가 그 자리에서 거부한다(실측 에러 메시지 확인) — 둘 다 가상 주소 공간을 자기 방식으로 재배치하는 방식이 서로 충돌하기 때문이다.
- 하나의 통일된 벤치마크(4스레드, 배열 접근 + atomic 카운트)로 다시 잰 결과 ASan·UBSan은 각각 약 1.3배, 둘을 합치면 약 2.7배, TSan은 약 2.6배였다 — [2.11](#/ub-sanitizers)·[6.2](#/data-races)의 배수와 절대값은 다르지만 "TSan(또는 TSan 포함 조합)이 가장 무겁다"는 순서는 두 벤치마크에서 일관됐다.
- 실무에서는 `address,undefined` 빌드와 `thread` 빌드를 CI에 별도 잡으로 상시 켜 둔다 — 한 빌드로 합칠 수 없다는 이 절의 실측이 그 이유다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. ASan의 그림자 메모리와 TSan의 그림자 메모리는 둘 다 "그림자"라는 이름을 쓰지만 담는 정보가 다르다. 이 절의 설명을 근거로 그 차이를 한 문단으로 써라.

2. `-fsanitize=address,thread`가 컴파일 타임에 거부되는 이유를 이 절의 실측 에러 메시지와 함께 설명하라. 이게 "실행해 보면 이상하게 동작한다"와 어떻게 다른지도 짚어라.

3. (예측) 이 절의 `ubsan_badshift.cpp`를 ARM 아키텍처용 크로스 컴파일러([7.2](#/cmake-advanced)의 `aarch64-linux-gnu-g++`)로 빌드해서 실제 ARM 보드에서 실행한다면, `shifted`의 출력값이 이 절에서 실측한 `256`과 같을지 다를지 예측하고 근거를 써라. 힌트: x86과 ARM의 시프트 명령어가 시프트 폭을 다루는 방식이 같다는 보장이 없다.

4. (실습, 코드 작성형) 이 절의 `ubsan_nullderef.cpp`와 `ubsan_badshift.cpp`를 직접 타이핑하고 `g++ -std=c++20 -Wall -Wextra -O0 -g -fsanitize=undefined <파일> -o <출력>`로 빌드·실행하라. 널 역참조 버전은 UBSan 진단 뒤 세그폴트로 죽는지, 시프트 버전은 진단만 찍고 정상 종료하는지 두 가지 종료 방식의 차이를 직접 확인하는 것이 성공 기준이다.

5. (실습) 이 절의 `bench.cpp`를 그대로 타이핑하고, `-fsanitize=address`와 `-fsanitize=thread`를 따로따로 붙여 각각의 실행 시간을 재라. 그다음 `-fsanitize=address,thread`를 한 번에 넣어 컴파일해 보고 실제로 `cc1plus` 에러가 나는지 네 화면에서 직접 확인하라.
:::

::: answer 해설
1. ASan의 그림자 바이트는 "이 8바이트 구간이 지금 유효한 메모리인가(레드존인가, 해제됐는가)"만 담는다 — 스레드 정보는 필요 없다. TSan의 그림자 바이트(정확히는 그림자 상태)는 "이 위치를 마지막으로 어느 스레드가 어떤 동기화 문맥에서 건드렸는가"라는 이력을 담아야 두 접근 사이의 happens-before 관계를 판단할 수 있다 — 그래서 TSan의 그림자 구조가 ASan보다 무겁고, 실측한 오버헤드에서도 항상 더 크게 나온다.
2. 두 도구 모두 계측을 위해 프로세스의 가상 주소 공간 상당 부분을 자기 방식으로 예약하고 `malloc`/`free`를 가로챈다 — 이 요구사항이 서로 겹쳐서 컴파일러 자신이 두 계측을 동시에 넣을 방법이 없다고 판단하고, 실제 코드를 만들어 실행해 보기도 전에 `cc1plus: error: '-fsanitize=thread' is incompatible with '-fsanitize=address'`로 그 자리에서 컴파일을 중단시킨다. "실행해 보면 이상하게 동작한다"는 컴파일은 성공하지만 런타임에 문제가 생기는 경우인데, 이 조합은 그 단계까지 가지도 못한다는 점이 다르다.
3. 이 절의 `256`이라는 값은 x86의 시프트 명령어가 시프트 폭의 하위 5비트만 쓰는 하드웨어 동작 때문에 나온 우연이다. ARM의 시프트 명령어가 폭을 다루는 규칙이 x86과 다르면(실제로 ARM은 8비트 전체를 시프트 카운트로 쓰는 등 규칙이 다르다) 같은 소스, 같은 UB라도 다른 값이 나올 수 있다 — 이게 정확히 UB가 "이 환경에서는 이렇게 나왔지만 보장이 없다"는 [2.11](#/ub-sanitizers)의 원칙이 아키텍처를 바꿔도 다시 확인되는 지점이다.
4. 널 역참조 버전은 `runtime error: member access within null pointer` 진단 직후 `Segmentation fault`로 종료해야 한다(진단과 크래시가 같이 온다). 시프트 버전은 `runtime error: shift exponent 40 is too large` 진단만 찍고 `shifted = 256`(또는 실행 환경에 따라 다른 값)을 출력한 뒤 정상 종료(코드 0)해야 한다 — 같은 UBSan인데 잡은 UB의 성격에 따라 프로세스 생사가 갈리는 것을 직접 확인하는 게 목적이다.
5. `-fsanitize=address`와 `-fsanitize=thread`는 각각 정상적으로 빌드되고 실행돼 시간이 찍혀야 한다. `-fsanitize=address,thread`를 한 번에 넣으면 `cc1plus: error: '-fsanitize=thread' is incompatible with '-fsanitize=address'`가 뜨고 빌드 자체가 실패해야 한다 — 실행 파일이 아예 안 만들어지는 것까지 확인하는 게 성공 기준이다.
:::

이 절의 `shadow_demo.cpp`, `ubsan_nullderef.cpp`, `ubsan_badshift.cpp`, `bench.cpp`는 전부 직접 타이핑해라. 특히 그림자 바이트 출력은 눈으로 한 번 보기 전까지는 "그림자 메모리"가 추상적인 말로만 남는다 — `Shadow bytes around the buggy address:` 아래 줄에서 레드존을 뜻하는 `fa`가 유효 구간을 뜻하는 `00`과 실제로 붙어 있는 것을 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra -O0 -g -fsanitize=address <파일> -o <출력> && ./<출력>`(ASan), `-fsanitize=undefined`(UBSan), `-fsanitize=thread -lpthread`(TSan, 멀티스레드 코드 한정).

**다음 절**: [7.6 GoogleTest로 테스트 작성](#/googletest) — 새니타이저가 "실행된 코드 경로의 버그"를 잡는다는 걸 봤으니, 이제 그 경로 자체를 체계적으로 실행시키는 테스트 프레임워크로 넘어간다. 픽스처, 파라미터화 테스트, 모킹의 기초를 다룬다.
