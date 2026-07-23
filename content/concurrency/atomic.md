# 6.5 atomic과 메모리 오더

::: lead
[6.3](#/mutex)에서 `std::mutex`로 `counter++`를 다시 원자적인 덩어리로 만들었다. 그런데 그 해법은 임계 구역 진입에 락 하나를 통째로 걸었다 — 카운터 하나 늘리는 데 lock/unlock 두 번, 예외 안전 걱정, 데드락 가능성까지 딸려 왔다. `counter++` 하나에 그 정도 장비가 정말 필요할까? 이 절은 `std::atomic`으로 같은 문제를 뮤텍스 없이 고치고, 그 비용을 실측으로 뮤텍스와 견주고, CAS(compare-and-swap)로 락 없는 알고리즘의 기본 블록을 만들어 본다. 그리고 이 절에서 가장 중요한 것 — atomic이라고 다 같은 게 아니라는 것, 메모리 오더(memory order)를 잘못 고르면 값은 원자적으로 바뀌었는데 그 옆에 있던 데이터는 아직 안 보이는 상황이 표준상 합법이라는 것을 ThreadSanitizer로 실제로 잡아서 보여준다.
:::

## counter++ 를 atomic 하나로 고친다

6.2/6.3에서 계속 써 온 카운터 코드를 그대로 가져온다. 이번엔 `long counter`를 `std::atomic<long>`으로 바꾸는 것 말고는 아무것도 손대지 않는다 — 뮤텍스도, lock/unlock도 없다.

```cpp title="atm2_atomic_fix.cpp — atomic으로 고친 counter++"
#include <atomic>
#include <iostream>
#include <thread>

constexpr long N = 5'000'000;
std::atomic<long> counter{0};   // 뮤텍스 없이 동기화된 카운터

void increment_loop() {
    for (long i = 0; i < N; ++i) {
        counter++;   // std::atomic<long>::operator++ -- 하드웨어 원자적 증가
    }
}

int main() {
    std::thread t1(increment_loop);
    std::thread t2(increment_loop);
    t1.join();
    t2.join();
    std::cout << "기대값: " << (2 * N) << ", 실제값: " << counter.load() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -O0 -Wall -Wextra atm2_atomic_fix.cpp -o atm2_atomic_fix -lpthread
$ for i in 1 2 3 4 5; do ./atm2_atomic_fix; done
기대값: 10000000, 실제값: 10000000
기대값: 10000000, 실제값: 10000000
기대값: 10000000, 실제값: 10000000
기대값: 10000000, 실제값: 10000000
기대값: 10000000, 실제값: 10000000
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 / `-O0` 실측.) 다섯 번 모두 정확히 1,000만이다. 눈으로 값만 보고 판단하면 안 된다는 걸 [6.2](#/data-races)에서 이미 배웠으니 — TSan으로 재확인한다.

```console
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra atm2_atomic_fix.cpp -o atm2_tsan -lpthread
$ ./atm2_tsan
기대값: 10000000, 실제값: 10000000
$ echo $?
0
```

(g++ 13.3.0 실측.) 경고 0건, 종료 코드 0 — [6.3](#/mutex)에서 `mut2_lock_unlock.cpp`가 TSan을 조용히 통과했던 것과 같은 결과를, 뮤텍스도 lock/unlock도 없이 얻었다. `counter`를 `std::atomic<long>`으로 선언한 것만으로 `counter++`가 어셈블리 층위에서 다시 하나의 원자적 연산이 됐다는 뜻이다.

### 어셈블리로 확인: lock xadd 하나

[6.2](#/data-races)에서 일반 `long`의 `counter++`가 load-add-store 세 개의 별개 명령으로 쪼개지는 걸 봤다. `std::atomic<long>`은 어떻게 다른지 오브젝트 파일을 역어셈블해서 확인한다.

```console
$ g++ -std=c++20 -O0 -c atm2_atomic_fix.cpp -o atm2_atomic_fix_O0.o
$ objdump -d --no-show-raw-insn -M intel atm2_atomic_fix_O0.o
```

```text nolines
0000000000000000 <_ZNSt13__atomic_baseIlEppEi>:
   0:  endbr64
   ...
  1f:  mov    DWORD PTR [rbp-0x14],0x5
  26:  mov    rdx,QWORD PTR [rbp-0x8]
  2a:  mov    rax,QWORD PTR [rbp-0x10]
  2e:  lock xadd QWORD PTR [rax],rdx
  33:  mov    rax,rdx
  36:  pop    rbp
  37:  ret
```

(g++ 13.3.0 / x86-64 / `-O0` 실측, 인자 준비 코드는 줄였다.) `operator++`가 실제로 부르는 함수 안에 `lock xadd`가 딱 한 줄 있다. `xadd`(exchange-and-add)는 "메모리 값을 읽고, 더하고, 다시 쓰는" 세 단계를 CPU가 **하나의 명령**으로 실행하는 것이고, 그 앞의 `lock` 접두어가 그 명령이 실행되는 동안 다른 코어가 같은 캐시 라인에 끼어들지 못하게 버스/캐시 일관성 프로토콜 수준에서 잠근다. [6.2](#/data-races)에서 본 load-add-store 세 명령 사이에 다른 스레드가 끼어들 수 있었던 그 "틈"이, `lock xadd` 하나짜리 명령에는 아예 없다 — 명령 자체가 더 이상 쪼개지지 않는 단위이기 때문이다. 이게 `std::atomic`이 뮤텍스 없이 안전한 이유의 전부다: 락을 걸어서 기다리게 하는 게 아니라, 하드웨어가 원래부터 원자적인 명령 하나로 끝내 버린다.

::: warn -O2 에서도 이번엔 500만 번이 통째로 안 접힌다
[6.2](#/data-races)의 `-O2`는 `counter++` 500만 번짜리 루프를 `add [counter], 5000000` 명령 하나로 접었다 — 레이스가 없어진 게 아니라 우연히 겹칠 확률이 낮아진 것뿐이었다. `std::atomic<long>`으로 같은 루프를 `-O2`로 다시 컴파일하면 어셈블리가 다르다.

```text nolines
0000000000000000 <_Z14increment_loopv>:
   0:  endbr64
   4:  mov    eax,0x4c4b40
   9:  nop    DWORD PTR [rax+0x0]
  10:  lock add QWORD PTR [rip+0x0],0x1
  19:  lock add QWORD PTR [rip+0x0],0x1
  22:  sub    rax,0x2
  26:  jne    10 <_Z14increment_loopv+0x10>
  28:  ret
```

컴파일러가 루프를 2회씩 펼쳤을(unroll) 뿐, `lock add`가 여전히 500만 번(정확히는 250만 쌍) 실행된다 — 6.2처럼 "덧셈 하나로 접기"가 여기서는 **불가능**하다. atomic 연산 각각은 다른 스레드가 그 사이의 중간값을 실제로 관측할 수 있다는 것을 컴파일러가 보장해야 하고, 500만 번을 한 번에 더해 버리면 그 사이의 중간값 499만 9999개가 전부 증발한다 — 이건 표준이 atomic에 대해 절대 허용하지 않는 최적화다. "atomic은 컴파일러의 최적화 권한을 스스로 깎아서 안전을 산다"는 게 정확한 요약이다.
:::

## atomic의 실제 비용: 뮤텍스와 실측 비교

atomic이 안전하다는 건 봤다. 값을 잰다 — 경합이 없을 때와 있을 때, `std::mutex`로 감싼 증가와 `std::atomic`의 증가가 각각 몇 나노초인지 [6.3](#/mutex)의 `mut8_cost.cpp`와 같은 방법론으로 비교한다.

```cpp title="atm3_cost.cpp — 경합 없을 때 뮤텍스 vs atomic"
#include <atomic>
#include <chrono>
#include <iostream>
#include <mutex>

std::mutex m;
long long mutex_counter = 0;
std::atomic<long long> atomic_counter{0};

double bench_mutex_uncontended(long iters) {
    auto start = std::chrono::steady_clock::now();
    for (long i = 0; i < iters; ++i) {
        m.lock();
        ++mutex_counter;
        m.unlock();
    }
    auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::nano>(end - start).count() / iters;
}

double bench_atomic_uncontended(long iters) {
    auto start = std::chrono::steady_clock::now();
    for (long i = 0; i < iters; ++i) {
        ++atomic_counter;
    }
    auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::nano>(end - start).count() / iters;
}

int main() {
    double mu = bench_mutex_uncontended(20'000'000);
    std::cout << "뮤텍스 (경합 없음): " << mu << " ns/증가\n";
    double au = bench_atomic_uncontended(20'000'000);
    std::cout << "atomic (경합 없음): " << au << " ns/증가\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 atm3_cost.cpp -o atm3_cost -lpthread
$ ./atm3_cost
뮤텍스 (경합 없음): 5.50727 ns/증가
atomic (경합 없음): 6.4362 ns/증가
```

(g++ 13.3.0 / `-O2` / 실측, 3회 반복에서 뮤텍스는 5.5~5.6ns, atomic은 6.4~6.5ns 사이로 흔들렸다.) 경합이 전혀 없을 때는 **atomic이 오히려 근소하게 더 비쌌다.** 예상 밖의 결과라면 그게 정확히 이 실측의 요점이다 — glibc의 `std::mutex` 빠른 경로(아무도 안 기다리는 상태에서 lock/unlock)도 결국 원자적 명령 한두 개로 끝나는 futex 기반 구현이라([6.3](#/mutex) 참고), 경합이 없는 한 뮤텍스와 atomic은 "하드웨어 원자적 명령 하나 vs 몇 개"의 차이일 뿐 자릿수가 다른 비용이 아니다. 차이가 벌어지는 건 **경합이 생겼을 때**다 — 4개 스레드가 같은 카운터를 동시에 두드리게 해서 다시 잰다.

```cpp title="atm3b_cost_contended.cpp — 스레드 4개가 동시에 두드릴 때"
#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#include <vector>

std::mutex m;
long long mutex_counter = 0;
std::atomic<long long> atomic_counter{0};

double bench_mutex_contended(int n_threads, long iters_per_thread) {
    std::vector<std::thread> ts;
    auto start = std::chrono::steady_clock::now();
    for (int i = 0; i < n_threads; ++i)
        ts.emplace_back([iters_per_thread] {
            for (long i = 0; i < iters_per_thread; ++i) { m.lock(); ++mutex_counter; m.unlock(); }
        });
    for (auto& t : ts) t.join();
    double total_ns = std::chrono::duration<double, std::nano>(
        std::chrono::steady_clock::now() - start).count();
    return total_ns / (static_cast<double>(n_threads) * iters_per_thread);
}

double bench_atomic_contended(int n_threads, long iters_per_thread) {
    std::vector<std::thread> ts;
    auto start = std::chrono::steady_clock::now();
    for (int i = 0; i < n_threads; ++i)
        ts.emplace_back([iters_per_thread] {
            for (long i = 0; i < iters_per_thread; ++i) { ++atomic_counter; }
        });
    for (auto& t : ts) t.join();
    double total_ns = std::chrono::duration<double, std::nano>(
        std::chrono::steady_clock::now() - start).count();
    return total_ns / (static_cast<double>(n_threads) * iters_per_thread);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 atm3b_cost_contended.cpp -o atm3b_cost_contended -lpthread
$ ./atm3b_cost_contended
뮤텍스 (경합, 스레드 4개): 44.0954 ns/증가
atomic (경합, 스레드 4개): 14.5664 ns/증가
뮤텍스가 atomic보다 3.0272배 느림
```

(g++ 13.3.0 / `-O2` / 4코어 실측 — 3회 반복에서 배율은 2.8~4.4배 사이로 흔들렸지만 매번 atomic이 뮤텍스보다 확실히 쌌다.) 스레드 4개가 경합하자 뮤텍스는 44ns, atomic은 14.6ns — **atomic이 3배 이상 싸다.** [6.3](#/mutex)에서 실측한 이유 그대로다: 경합이 생기면 뮤텍스는 futex의 커널 대기 큐로 넘어가 스레드를 재우고 깨우는 문맥 전환을 거치지만, `lock xadd` 한 줄짜리 atomic 증가는 커널에 진입할 일 자체가 없다 — 두 코어가 같은 캐시 라인을 놓고 하드웨어 수준에서 잠깐 순서를 다투는 것뿐이다. **경합이 없으면 둘은 비슷한 자릿수고, 경합이 생기면 atomic이 확실히 이긴다**는 게 이 두 실측이 말하는 결론이다 — 그리고 여러 스레드가 진짜로 공유하는 카운터라면 경합은 결국 생긴다.

::: perf 카운터 하나 늘리는 데 뮤텍스는 과하다
공유 카운터, 플래그, 통계값 하나처럼 **"값 하나"를 여러 스레드가 갱신하는** 자리에는 뮤텍스보다 atomic이 기본 선택지가 돼야 한다 — 임계 구역도, 데드락 걱정도, lock/unlock 짝 맞추기도 없이 같은 안전성을 더 싸게 얻는다. 반대로 "값 여러 개를 하나의 불변식 아래 함께 바꿔야 하는" 자리(예: 자세 추정치 구조체 전체)는 atomic 여러 개를 따로 갱신해서는 그 사이 순간에 일관성 없는 상태가 노출될 수 있다 — 그런 자리는 여전히 뮤텍스([6.3](#/mutex))의 몫이다.
:::

## compare_exchange: 락 없는 알고리즘의 기본 블록

atomic이 제공하는 연산 중 가장 강력한 건 `compare_exchange`다 — "현재 값이 기대값과 같으면 새 값으로 바꾸고, 다르면 안 바꾼다"를 **한 번에 원자적으로** 해준다. 이름 그대로 CAS(compare-and-swap)다.

```cpp title="atm4_cas_basic.cpp — compare_exchange_strong의 성공과 실패"
#include <atomic>
#include <iostream>

int main() {
    std::atomic<int> value{10};

    int expected = 10;
    bool ok1 = value.compare_exchange_strong(expected, 99);
    std::cout << "1차 시도: ok=" << ok1 << ", value=" << value.load()
              << ", expected=" << expected << "\n";

    expected = 10;   // 이번엔 실제 값(99)과 다르다 -- 교체가 실패해야 한다
    bool ok2 = value.compare_exchange_strong(expected, 42);
    std::cout << "2차 시도: ok=" << ok2 << ", value=" << value.load()
              << ", expected=" << expected << " (실패 시 expected가 실제 값으로 갱신된다)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra atm4_cas_basic.cpp -o atm4_cas_basic -lpthread
$ ./atm4_cas_basic
1차 시도: ok=1, value=99, expected=10
2차 시도: ok=0, value=99, expected=99 (실패 시 expected가 실제 값으로 갱신된다)
```

(g++ 13.3.0 실측.) 첫 호출은 `value`가 정말 10이었으므로 99로 바뀌고 `true`를 돌려준다. 두 번째 호출은 `expected`에 10을 다시 넣었지만 실제 `value`는 이미 99라 교체는 실패하고 `false`를 돌려준다 — 그리고 **`expected` 자신이 실제 값(99)으로 덮어써진다.** 이 "실패하면 기대값을 최신값으로 채워 준다"는 동작이 CAS를 반복문 안에 넣어 쓰는 표준 패턴을 만든다: 실패했다는 건 다른 스레드가 그 사이 값을 바꿨다는 뜻이고, `expected`는 이미 그 최신값을 담고 있으니 그 값을 기준으로 계산만 다시 해서 또 시도하면 된다.

`compare_exchange_weak`와 `compare_exchange_strong`의 차이는 딱 하나다 — **`weak`는 값이 실제로 기대값과 같았는데도 가끔 실패할 수 있다**(spurious failure, 일부 아키텍처에서 CAS를 구현하는 load-linked/store-conditional 명령 쌍이 그 사이에 다른 메모리 접근이 끼면 이유 없이 실패하는 경우가 있다). `strong`은 그런 거짓 실패가 없는 대신 내부적으로 그 실패까지 스스로 재시도하느라 미세하게 더 무겁다. 그래서 관용구가 정해져 있다 — **어차피 반복문 안에서 쓸 거면 `weak`를 쓰고, 반복문 없이 딱 한 번만 시도할 거면 `strong`을 쓴다.** 반복문 안에서는 거짓 실패도 "다시 돌면 그만"이라 `weak`의 미세한 비용 이점을 그냥 가져갈 수 있다.

### CAS 루프로 락 없는 최댓값 갱신

이 패턴을 실제로 써 본다 — 여러 스레드가 "지금까지 본 값 중 최댓값"을 뮤텍스 없이 갱신한다.

```cpp title="atm5_cas_max.cpp — CAS 루프로 만든 락 없는 max"
#include <atomic>
#include <thread>
#include <vector>

std::atomic<int> global_max{0};

void update_max(int candidate) {
    int current = global_max.load(std::memory_order_relaxed);
    while (candidate > current &&
           !global_max.compare_exchange_weak(current, candidate,
                                              std::memory_order_relaxed)) {
        // 실패하면 current가 최신값으로 자동 갱신되어 루프 조건을 다시 검사한다
    }
}

int main() {
    constexpr int n_threads = 8;
    constexpr int per_thread = 100'000;
    std::vector<std::thread> ts;
    for (int t = 0; t < n_threads; ++t) {
        ts.emplace_back([t] {
            for (int i = 0; i < per_thread; ++i)
                update_max(t * per_thread + i);   // 스레드 t의 최댓값 후보: t*100000 + 99999
        });
    }
    for (auto& t : ts) t.join();
    // 정답: (8-1)*100000 + 99999 = 799999
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 atm5_cas_max.cpp -o atm5_cas_max -lpthread
$ ./atm5_cas_max
CAS 루프로 갱신한 최댓값: 799999
정답(스레드 7의 마지막 후보): 799999
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra atm5_cas_max.cpp -o atm5_tsan -lpthread
$ ./atm5_tsan; echo $?
CAS 루프로 갱신한 최댓값: 799999
정답(스레드 7의 마지막 후보): 799999
0
```

(g++ 13.3.0 실측, 5회 반복 모두 정답 799999. TSan 경고 0건, 종료 코드 0.) 뮤텍스도 락도 없이 8개 스레드가 같은 `global_max`를 두드렸는데 매번 정확한 최댓값이 나오고 TSan도 조용하다 — `load → 조건 비교 → compare_exchange_weak`가 통째로 원자적 단위로 묶이기 때문이다. 이게 [6.6 lock-free 기초](#/lockfree)에서 다룰 모든 락 없는 자료구조의 공통 뼈대다: "값을 읽고, 계산하고, 그 사이 아무도 안 바꿨으면 쓴다. 바꿨으면 다시."

## 메모리 오더: 왜 그냥 값 하나 늘리는데 옵션이 네 개나 있나

지금까지 쓴 `counter++`, `compare_exchange_weak(current, candidate, std::memory_order_relaxed)`에는 이미 메모리 오더가 등장했다. `std::atomic`의 모든 연산은 **이 연산이 다른 메모리 접근과 어떤 순서 관계를 갖는지**를 지정하는 `std::memory_order` 인자를 받는다(생략하면 `memory_order_seq_cst`가 기본값이다). 실무적으로 중요한 건 넷뿐이다.

- **`memory_order_relaxed`**: 이 연산이 원자적이라는 것만 보장한다. 다른 메모리 접근과의 순서는 **전혀** 보장하지 않는다. 통계 카운터처럼 "정확히 몇 번 늘었는지"만 중요하고 "언제 늘었는지, 그 전후로 뭐가 보이는지"는 상관없을 때만 쓴다.
- **`memory_order_release`** (쓰기 연산에)와 **`memory_order_acquire`**(읽기 연산에): 짝을 이뤄 쓴다. release로 저장하기 **이전**의 그 스레드의 모든 메모리 쓰기가, 같은 값을 acquire로 읽은 **이후**의 다른 스레드에 전부 보이는 것을 보장한다. "플래그 하나로 그 앞에 준비해 둔 데이터를 안전하게 넘긴다"는 패턴의 정확한 이름이 이거다.
- **`memory_order_seq_cst`**(기본값): acquire/release가 보장하는 것에 더해, **모든 스레드가 모든 seq_cst 연산의 순서에 동의**하게 만든다 — 가장 강하고, 가장 이해하기 쉽고, 대가도 가장 크다. **특별한 이유가 없으면 이걸 쓴다.** 이 절 나머지가 다루는 relaxed/acquire·release는 실측으로 그 대가가 실제로 얼마인지, 그리고 잘못 골랐을 때 뭐가 깨지는지를 보여주기 위한 것이지, "기본값을 피해라"는 뜻이 아니다.

### 어셈블리로 본 진짜 차이 — x86에서는 store만 다르다

네 옵션이 실제로 기계어 수준에서 뭘 다르게 만드는지 확인한다. 먼저 저장(store) 세 가지를 각각 다른 함수로 컴파일해서 나란히 본다.

```console
$ g++ -std=c++20 -O2 -c atm10_store_asm.cpp -o atm10_store_asm.o
$ objdump -d --no-show-raw-insn -M intel atm10_store_asm.o
```

```text nolines
0000000000000000 <_Z12store_seqcsti>:
   4:  xchg   DWORD PTR [rip+0x0],edi        # a.store(v, seq_cst)

0000000000000010 <_Z13store_releasei>:
  14:  mov    DWORD PTR [rip+0x0],edi        # a.store(v, release)

0000000000000020 <_Z13store_relaxedi>:
  24:  mov    DWORD PTR [rip+0x0],edi        # a.store(v, relaxed)
```

(g++ 13.3.0 / `-O2` / x86-64 실측.) `seq_cst` 저장은 `xchg`(잠긴 교환 명령, x86에서는 `lock` 접두어 없이도 메모리 피연산자에 대해 항상 원자적이며 완전한 메모리 펜스 역할을 한다) 하나를 쓰고, `release`와 `relaxed`는 **완전히 같은** 평범한 `mov` 한 줄이다. 읽기(load) 세 가지도 확인해 본다.

```text nolines
<load_seqcst>: mov eax,DWORD PTR [rip+0x0]
<load_acquire>: mov eax,DWORD PTR [rip+0x0]
<load_relaxed>: mov eax,DWORD PTR [rip+0x0]
```

(g++ 13.3.0 / `-O2` 실측.) 읽기는 오더에 상관없이 **셋 다 같은 `mov`다.** x86-64는 하드웨어 자체가 이미 강한 메모리 모델(TSO)을 갖고 있어서, 일반적인 load는 이미 acquire만큼 강하고 일반적인 store는 이미 release만큼 강하다 — 그래서 `release`/`relaxed`/`acquire` 세 오더가 x86에서는 코드 생성 층위에서 공짜로 구별되지 않는다. 대신 `seq_cst`만은 "모든 스레드가 모든 연산의 순서에 동의한다"는 더 강한 약속을 지키기 위해 저장 시점에 추가 하드웨어 동작(`xchg`)이 필요하다.

::: warn 이건 x86 얘기다, ARM은 다르다
이 실측은 x86-64 한정이다. ARM처럼 더 약한 메모리 모델을 쓰는 아키텍처에서는 `acquire`/`release`/`relaxed`가 서로 다른 실제 명령(메모리 배리어 유무)으로 컴파일되고, 그 사이의 실행 속도 차이도 x86보다 뚜렷하게 드러난다. "relaxed가 항상 무조건 더 빠르다"는 말은 아키텍처를 명시하지 않으면 부정확하다 — 이 절의 결론은 x86-64 / g++ 13.3.0 기준이다.
:::

## relaxed로 데이터를 넘기면 안 되는 이유 — 실제로 TSan이 잡은 레이스

메모리 오더 이야기가 추상적으로 들릴 수 있으니, 왜 relaxed를 함부로 쓰면 안 되는지를 실제 코드와 실제 TSan 리포트로 보여준다. "작업 완료" 플래그 하나로 그 앞에 준비해 둔 데이터를 다른 스레드에 넘기는 흔한 패턴이다.

```cpp title="atm6_flag_acqrel.cpp — release/acquire로 올바르게 데이터를 넘긴다"
#include <atomic>
#include <string>
#include <thread>

std::string payload;              // 평범한(비원자) 데이터
std::atomic<bool> ready{false};   // "데이터 준비됐다" 신호만 원자적으로 전달

void producer() {
    payload = "제어 명령: leg_ik_target = {0.12, -0.04, 0.30}";   // (1) 먼저 쓴다
    ready.store(true, std::memory_order_release);                 // (2) release
}

void consumer() {
    while (!ready.load(std::memory_order_acquire))   // acquire
        std::this_thread::yield();
    // 여기 도달했다면 (1)의 쓰기가 반드시 보인다 -- release/acquire가 보장한다
    std::cout << "소비자가 읽은 payload: \"" << payload << "\"\n";
}
```

```console
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra atm6_flag_acqrel.cpp -o atm6_tsan -lpthread
$ for i in 1 2 3 4; do ./atm6_tsan > /dev/null; echo "exit=$?"; done
exit=0
exit=0
exit=0
exit=0
```

(g++ 13.3.0 실측, 4회 반복 모두 조용함.) `release`로 쓰고 `acquire`로 읽으니 TSan이 매번 조용하다 — `payload`에 대한 접근이 `ready`를 통해 순서가 강제된다는 것을 TSan이 확인해 준다. 이제 `release`/`acquire`를 전부 `relaxed`로만 바꾼다. 딱 이 한 글자씩만 바뀐다.

```cpp title="atm7_flag_relaxed.cpp — 딱 하나, memory_order를 relaxed로 바꿨다"
void producer() {
    payload = "제어 명령: leg_ik_target = {0.12, -0.04, 0.30}";
    ready.store(true, std::memory_order_relaxed);   // release -> relaxed
}
void consumer() {
    while (!ready.load(std::memory_order_relaxed))  // acquire -> relaxed
        std::this_thread::yield();
    std::cout << "소비자가 읽은 payload: \"" << payload << "\"\n";
}
```

```console
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra atm7_flag_relaxed.cpp -o atm7_tsan -lpthread
$ ./atm7_tsan
==================
WARNING: ThreadSanitizer: data race (pid=4227)
  Read of size 8 at 0x721000002000 by thread T2:
    #0 ... std::__ostream_insert(...) (소비자의 std::cout << payload 안에서 발생)
  Previous write of size 8 at 0x721000002000 by thread T1:
    #0 ... producer() atm7_flag_relaxed.cpp:10
SUMMARY: ThreadSanitizer: data race ... in std::__ostream_insert(...)
==================
소비자가 읽은 payload: "제어 명령: leg_ik_target = {0.12, -0.04, 0.30}"
ThreadSanitizer: reported 1 warnings
$ echo $?
66
```

(g++ 13.3.0 실측, 표준 라이브러리 내부 호출 스택 줄은 지면상 줄였다. 4회 반복 모두 동일하게 레이스가 잡혔다.) `ready`를 `relaxed`로 읽고 쓴다고 해서 `ready` 자체가 깨지는 건 아니다 — `bool` 하나는 여전히 원자적으로 정확히 갱신된다. 문제는 **`ready`가 `payload`와 순서 관계를 더 이상 못박지 않는다**는 것이다. TSan은 정확히 그 지점을 잡는다 — `producer()`의 `payload = ...` 줄(`atm7_flag_relaxed.cpp:10`)에서의 쓰기와, 소비자가 `payload`를 읽는 지점 사이에 어떤 동기화 관계도 없다고 리포트한다. 이번 실행에서는 우연히 출력된 문자열이 정확했지만(`ready`가 관측된 시점에 `payload`도 이미 다 써진 상태였을 뿐), **표준은 이걸 보장하지 않는다** — `relaxed`만으로는 컴파일러도 하드웨어도 `payload`의 쓰기가 `ready`의 쓰기보다 먼저 다른 스레드에 보이도록 만들 의무가 없다. 즉 이론적으로 소비자가 `ready == true`를 보고도 아직 옛날(빈) `payload`를 읽는 게 완전히 합법적인 결과다. **relaxed로 값 하나의 원자성은 살 수 있어도, 그 값과 묶인 다른 데이터의 가시성은 절대 못 산다** — 이게 이 절에서 가장 중요한 실측이다.

::: danger relaxed로 데이터를 넘기려 하지 마라
플래그 하나로 다른 데이터를 넘기는 패턴("이 데이터 다 썼다"를 알리는 `ready`, "새 명령 도착"을 알리는 `has_new_command` 등)은 **항상 `release`(쓰는 쪽)/`acquire`(읽는 쪽)를 짝지어 쓰거나, 확신이 없으면 그냥 기본값 `seq_cst`를 써라.** `relaxed`는 "이 값 자체의 최종 결과만 맞으면 되고, 그 값이 언제 어떤 순서로 보이는지, 그 옆에 있던 다른 메모리가 뭘 보이는지는 전혀 상관없는" 순수한 카운터·통계값에만 쓴다. 이 절의 `atm5_cas_max.cpp`가 `relaxed`를 쓴 이유가 정확히 이것이다 — `global_max` 하나 말고는 넘겨야 할 다른 데이터가 없었다.
:::

## 로보틱스 도메인: 제어 루프의 "새 명령 도착" 신호

[6.3](#/mutex)에서 뮤텍스의 경합 비용이 제어 루프의 지터로 번진다는 걸 봤다. 이 절에서 실측한 카운터 비교(경합 시 atomic이 3배 이상 쌈, 커널 진입 없음)가 정확히 그 문제의 답이 될 수 있는 자리 하나가 있다 — 상위 계획 스레드가 새 목표 관절각을 계산해 두고, 실시간 제어 루프 스레드가 "새 명령이 도착했는가"만 매 주기 확인하는 구조다. 이걸 뮤텍스로 하면 계획 스레드가 갱신하는 순간과 제어 루프가 읽는 순간이 겹칠 때마다 제어 루프 스레드가 futex 대기 큐에 들어갈 위험을 안게 된다 — [6.8 실시간 제약](#/realtime)이 정면으로 금지하는 상황이다. 대신 `std::atomic<bool> new_command_ready`를 계획 스레드가 `release`로 세우고 제어 루프가 매 주기 `acquire`로 확인하게 하면, 제어 루프는 절대 블록되지 않고(값이 안 바뀌었으면 그냥 `false`를 즉시 돌려받는다), 값이 바뀌었을 땐 그 앞에 계획 스레드가 써 둔 목표각 데이터가 확실히 보인다 — 이 절의 `atm6_flag_acqrel.cpp`가 정확히 이 패턴의 최소 뼈대다. [10.9 ros2_control과 hardware_interface](#/ros2-control)의 상태 버퍼 교체 구조에서도 이런 락 없는 신호 전달이 핵심 부품으로 쓰인다.

::: note C++20: atomic<shared_ptr<T>>
C++20부터는 `std::atomic<std::shared_ptr<T>>`처럼 `shared_ptr` 자체를 원자적으로 읽고 쓰는 특수화도 표준에 있다(g++ 13.3.0에서 실제로 컴파일·실행 확인됨). 참조 카운트와 포인터를 함께 원자적으로 바꿔야 하는 자리(예: 여러 스레드가 공유하는 최신 설정 객체를 통째로 바꿔치기)에 쓰지만, 일반적인 자료구조 갱신에는 [6.6 lock-free 기초](#/lockfree)에서 다룰 전용 자료구조가 더 맞는 경우가 많다 — 이 절에서는 이런 게 있다는 것만 짚고 넘어간다.
:::

::: interview atomic이 뮤텍스보다 항상 빠른가
"당연히 그렇다"고 답하면 틀린다. 이 절의 실측이 정확한 답이다 — **경합이 없으면 뮤텍스의 빠른 경로(futex 기반, 단일 원자적 명령급)와 atomic 연산은 같은 자릿수의 비용**이고, 실제로 이 절의 측정에서는 atomic이 근소하게 더 비싸기도 했다. 차이가 벌어지는 건 **경합이 생겼을 때**다 — 뮤텍스는 커널 대기 큐로 넘어가 문맥 전환을 겪지만, atomic의 `lock xadd`/CAS는 하드웨어 캐시 일관성 프로토콜 수준에서 끝나 커널에 절대 진입하지 않는다. "값 하나를 여러 스레드가 갱신"하는 좁은 경우에 한해 atomic이 뮤텍스의 대안이 된다는 것, 그리고 그 이점이 두드러지는 건 경합이 실제로 생길 때라는 것까지 말해야 완전한 답이다.
:::

## 요약

- `std::atomic<long>`으로 바꾼 `counter++`는 뮤텍스 없이도 다섯 번 모두 정확한 결과를 냈고 TSan도 조용했다(실측: `atm2`) — 어셈블리로 확인하면 `lock xadd` 한 줄이 원인이다. `-O2`에서도 500만 번의 개별 연산이 하나로 접히지 않는다(실측: `lock add`가 계속 남음) — 다른 스레드가 중간값을 관측할 수 있어야 한다는 게 atomic의 계약이기 때문이다.
- 경합이 없을 때 뮤텍스와 atomic의 비용은 같은 자릿수다(실측: 5.5ns vs 6.4ns, atomic이 오히려 근소하게 더 비쌈). 스레드 4개가 경합하면 atomic이 3배 이상 싸진다(실측: 44ns vs 14.6ns) — 뮤텍스만 커널의 futex 대기 경로를 타기 때문이다.
- `compare_exchange_weak`/`strong`(CAS)은 "기대값과 같으면 새 값으로 바꾼다"를 원자적으로 수행한다. `weak`는 거짓 실패가 있을 수 있는 대신 반복문 안에서 미세하게 더 싸고, `strong`은 반복 없이 한 번만 시도할 때 쓴다. CAS 루프는 락 없는 알고리즘의 공통 뼈대다(실측: `atm5`, 8스레드 락 없는 max 갱신이 매번 정답이고 TSan도 조용함).
- `memory_order_relaxed`는 원자성만 보장하고 순서는 전혀 보장하지 않는다. `release`/`acquire`는 짝을 이뤄 한 스레드의 release 이전 쓰기 전부를 다른 스레드의 acquire 이후에 보이게 한다. `seq_cst`(기본값)가 가장 강하고, 이유 없으면 이걸 쓴다. x86-64 실측에서 `seq_cst` 저장만 `xchg`를 쓰고 `release`/`relaxed`는 같은 `mov`다(load는 셋 다 동일) — 이 차이는 아키텍처마다 다르다.
- `relaxed`로 플래그를 세우고 그 옆의 비원자 데이터를 넘기려 하면 표준상 허용된 데이터 레이스가 된다 — 이 절에서 딱 한 단어(`release`/`acquire` → `relaxed`)만 바꿔서 TSan이 실제로 레이스를 잡는 걸 확인했다(실측: `atm7`, 4회 반복 모두 재현). 값 하나의 원자성과 그 옆 데이터의 가시성은 별개의 보장이다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·실행으로 확인하는 실습이다.

1. 이 절의 실측(경합 없음/있음)을 근거로, "atomic이 뮤텍스보다 항상 빠르다"는 주장이 왜 부정확한지 한 문단으로 설명하라.

2. `compare_exchange_weak`가 실제로는 값이 기대값과 똑같았는데도 `false`를 돌려줄 수 있다. 이 사실이 왜 반복문 안에서 쓰는 한 문제가 되지 않는지, `compare_exchange_strong` 대신 `weak`를 반복문 안에서 권장하는 이유와 함께 설명하라.

3. (예측) `atm6_flag_acqrel.cpp`에서 `ready.store(true, std::memory_order_release)`는 그대로 두고 `ready.load(std::memory_order_acquire)`만 `memory_order_relaxed`로 바꾼다면(한쪽만 relaxed), `payload`의 가시성이 여전히 보장되는지 예측하고 근거를 써라. 힌트: release/acquire는 반드시 짝을 이뤄야 하는지 생각해 봐라.

4. (실습, 코드 작성형) 이 절의 `atm6_flag_acqrel.cpp`(release/acquire 버전)와 `atm7_flag_relaxed.cpp`(relaxed 버전)를 각각 타이핑하고, 둘 다 `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra <파일> -o <출력> -lpthread`로 컴파일해서 TSan과 함께 실행하라. `atm6`은 여러 번 반복해도 경고가 안 뜨는지, `atm7`은 경고가 뜨는지(안 뜨면 몇 번 더 반복해서라도 재현되는지) 직접 확인하는 것이 성공 기준이다.
:::

::: answer 해설
1. 경합이 없을 때는 뮤텍스의 빠른 경로도 결국 원자적 명령 한두 개로 끝나는 futex 기반 구현이라 atomic과 같은 자릿수의 비용이고, 이 절의 실측에서는 atomic이 오히려 근소하게 더 비싸기까지 했다. 차이가 벌어지는 건 여러 스레드가 실제로 경합할 때다 — 뮤텍스는 커널의 futex 대기 큐로 넘어가 문맥 전환을 겪지만 atomic의 `lock xadd`/CAS는 커널에 진입하지 않는다. 그러므로 "atomic이 항상 빠르다"가 아니라 "값 하나를 갱신하는 자리에서, 경합이 있을 때 atomic이 확실히 싸다"가 정확한 진술이다.
2. `compare_exchange_weak`가 거짓 실패를 내도, 반복문의 다음 바퀴에서 `expected`가 이미 최신값으로 갱신된 채로 다시 시도하므로 결과의 정확성에는 영향이 없다 — "이번엔 운 나쁘게 한 번 더 돈다"일 뿐이다. `strong`은 이 거짓 실패까지 내부적으로 흡수해 절대 거짓으로 실패하지 않지만, 그 흡수 과정 자체가 약간의 추가 비용이다. 어차피 반복문 안에서 실패하면 또 도는 구조라면 `strong`의 그 보장이 필요 없으므로, 반복문 안에서는 관용적으로 `weak`를 쓴다.
3. 여전히 보장된다. release/acquire는 개념적으로 짝을 이루는 게 일반적이지만, 표준이 보장하는 건 "release로 쓴 값을 어떤 스레드가 acquire로 읽으면"이라는 조건이다 — 읽는 쪽이 acquire이기만 하면 되고, 쓰는 쪽도 release여야 그 관계가 성립한다. 문제는 반대 방향이다 — release로 썼는데 읽는 쪽이 relaxed로 읽으면, 값 자체(true/false)는 똑같이 보이더라도 그 값과 함께 넘어와야 할 `payload`의 가시성 보장이 깨진다. 즉 release는 있는데 acquire가 없으면(질문과 반대 방향) 안전하지 않다 — 두 쪽 다 있어야 하는 건 맞지만, 이 절 관점에서 핵심은 "약한 쪽 하나가 relaxed면 전체 보장이 깨진다"는 것이다.
4. `atm6`(release/acquire)은 몇 번을 반복해도 TSan 경고가 뜨지 않아야 한다 — `payload`에 대한 접근이 `ready`를 통해 순서가 강제되기 때문이다. `atm7`(relaxed)은 이 절의 실측처럼 `producer()`의 `payload = ...` 줄과 소비자의 읽기 사이에서 데이터 레이스 경고가 떠야 한다 — 실행 환경에 따라 매번 뜨지 않을 수도 있지만(타이밍에 의존하므로), 이 절에서는 4회 반복 모두 재현됐다. 뜨지 않는 실행이 있더라도 그게 "relaxed가 안전하다"는 증거가 아니라는 것, [6.2](#/data-races)에서 이미 배운 "레이스는 재현이 안 될 수도 있다"는 원칙이 여기도 그대로 적용된다는 것까지 확인하면 완전한 답이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `atm6`/`atm7`은 딱 한 단어(`release`/`acquire` ↔ `relaxed`)의 차이가 TSan 리포트의 유무를 가른다는 걸 눈으로 봐야 메모리 오더가 왜 "취향"이 아니라 "계약"인지 실감이 난다. 기준 명령: `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra main.cpp -o main -lpthread && ./main; echo "exit=$?"`.

**다음 절**: [6.6 lock-free 기초와 SPSC 큐](#/lockfree) — 이 절의 CAS 루프를 실전 자료구조로 확장한다. ABA 문제가 뭔지, 그리고 실시간 통신에 쓰는 단일 생산자-단일 소비자 링 버퍼를 락 없이 구현한다.
