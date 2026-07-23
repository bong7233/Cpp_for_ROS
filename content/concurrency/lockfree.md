# 6.6 lock-free 기초와 SPSC 큐

::: lead
[6.5](#/atomic)의 `atm5_cas_max.cpp`는 CAS 루프 하나로 뮤텍스 없이 최댓값을 갱신했다 — "읽고, 계산하고, 그 사이 아무도 안 바꿨으면 쓴다. 바꿨으면 다시"가 이 절에서 다룰 모든 락 없는 자료구조의 공통 뼈대라고 예고했다. 그런데 그 뼈대에는 구멍이 하나 있다 — CAS는 "지금 값이 내가 아까 읽은 값과 같은가"만 본다. 값이 그 사이에 바뀌었다가 우연히 다시 원래대로 돌아왔다면, CAS는 그걸 절대 구분하지 못한다. 이게 ABA 문제고, 포인터 기반 락 없는 자료구조를 실제로 무너뜨리는 원인 중 하나다. 이 절은 ABA 문제를 실제 코드로 재현해서 왜 위험한지 보여주고, 그다음 CAS조차 필요 없는 훨씬 다루기 쉬운 락 없는 자료구조 하나 — 단일 생산자-단일 소비자(SPSC) 링 버퍼 — 를 처음부터 끝까지 구현하고, 뮤텍스로 보호한 `std::queue`와 실측으로 비교한다.
:::

## CAS만으로는 부족하다 — ABA 문제

`atm5_cas_max.cpp`가 안전했던 이유를 다시 보면, 사실 특수한 조건 하나에 기대고 있었다 — `global_max`는 오직 증가만 한다. 어떤 스레드가 CAS 직전에 값을 읽고, 다른 스레드들이 그 사이에 값을 몇 번을 바꾸든, 최댓값은 절대 "아까 봤던 값으로 되돌아가지" 않는다. 그래서 "내가 읽은 값이 지금도 그대로다"라는 CAS의 확인이 곧 "그 사이 아무 일도 없었다"는 뜻과 정확히 같았다.

포인터를 다루는 락 없는 자료구조에서는 이 전제가 깨진다. 노드 하나를 head로 갖는 락 없는 스택을 생각해 본다.

```cpp title="lf0_naive_stack.cpp — 흔한 락 없는 스택의 pop (조각, ABA에 취약하다)"
struct Node { int value; Node* next; };
std::atomic<Node*> head{nullptr};

Node* pop() {
    Node* old_head = head.load();                 // (1) old_head = A 를 읽는다
    while (old_head &&
           !head.compare_exchange_weak(old_head, old_head->next)) {
        // 실패하면 old_head가 최신 head로 자동 갱신된다
    }
    return old_head;                                // (2) CAS 성공 -- 그런데 안전한가?
}
```

(1)에서 `old_head`가 노드 A를 가리켰다고 하자. CAS가 실행되기 직전, 다른 스레드가 끼어들어 A를 pop하고, 이어서 B도 pop하고, 그다음 A를 다시 push했다면 어떻게 될까. `head`는 지금 다시 A를 가리키고 있다 — **주소도 값도 pop 이전과 완전히 같다.** (2)의 CAS는 "head가 여전히 A인가"만 확인하므로 그대로 성공한다. 하지만 실제로는 스택 전체가 A → B → ... 구성에서 A만 남은 구성으로 완전히 뒤바뀐 뒤였다. CAS는 이 사이의 변화를 전혀 몰랐다 — 값이 A → B → A로 돌아온 것과 "아무 일도 없었던 것"을 구분할 방법이 CAS 자체에는 없기 때문이다. 이게 **ABA 문제**다: 값이 그때와 지금 같으면 CAS는 성공으로 판단하는데, 그 사이에 A에서 B로, 다시 A로 바뀌었어도 CAS에는 "안 바뀐 것"과 똑같이 보인다.

## ABA를 실제로 재현한다

타이밍을 우연에 맡기면 재현이 잘 안 될 수 있으니, 신호 변수로 두 스레드의 실행 순서를 강제로 고정해서 ABA를 100% 재현되게 만든다. 실전에서는 캐시 미스나 인터럽트, 스케줄러 선점이 이 "CAS 직전의 틈"을 자연히 만들어 내지만, 여기서는 `stage`라는 원자적 신호로 그 틈을 의도적으로 벌린다.

```cpp title="lf1_aba_repro.cpp — ABA 문제를 강제로 재현한다"
#include <atomic>
#include <iostream>
#include <thread>

struct Node { int value; Node* next; };

std::atomic<Node*> head{nullptr};
std::atomic<int> stage{0};                 // 두 스레드의 실행 순서를 강제로 맞추는 신호
std::atomic<Node*> victim_result{nullptr};

void push(Node* n) {
    n->next = head.load(std::memory_order_relaxed);
    while (!head.compare_exchange_weak(n->next, n)) {}
}

Node* pop_raw() {
    Node* old_head = head.load();
    while (old_head && !head.compare_exchange_weak(old_head, old_head->next)) {}
    return old_head;
}

// 희생자 스레드: old_head를 읽은 직후 일부러 멈춘다
void pop_victim() {
    Node* old_head = head.load();          // (1) old_head = &A 를 읽는다
    stage.store(1);
    while (stage.load() != 2) {}           // 다른 스레드가 A, B를 pop하고 A를 되돌려놓을 때까지 대기
    while (old_head && !head.compare_exchange_weak(old_head, old_head->next)) {}
    victim_result.store(old_head);          // (4) CAS는 성공한다 -- 그런데 정말 안전한가?
}

int main() {
    Node A{1, nullptr};
    Node B{2, nullptr};
    push(&B);   // head: B -> nullptr
    push(&A);   // head: A -> B -> nullptr

    std::thread t1(pop_victim);
    while (stage.load() != 1) {}   // t1이 (1)을 마치고 멈췄다는 신호를 기다린다

    Node* r2a = pop_raw();    // (2) A를 pop -- old_head(&A)가 안 바뀌었다는 게 t1의 CAS 전제
    Node* r2b = pop_raw();    // 스택에서 B도 pop -- 이제 스택은 비었다
    push(&A);                  // (3) A를 다시 push -- 값(1)도 주소(&A)도 완전히 똑같다
    stage.store(2);             // t1을 깨운다

    t1.join();
    Node* r1 = victim_result.load();

    std::cout << "방해 스레드 1번째 pop: 주소=" << r2a << ", value=" << r2a->value << "\n";
    std::cout << "방해 스레드 2번째 pop: 주소=" << r2b << ", value=" << r2b->value << "\n";
    std::cout << "희생자 스레드의 pop:   주소=" << r1  << ", value=" << r1->value  << "\n";
    std::cout << (r1 == r2a
        ? "-> ABA 발생: 같은 노드(A)가 두 스레드에 각각 한 번씩, 총 두 번 pop됐다\n"
        : "-> 이번 실행에서는 재현되지 않았다\n");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 lf1_aba_repro.cpp -o lf1_aba_repro -lpthread
$ for i in 1 2 3 4 5; do ./lf1_aba_repro; echo ---; done
방해 스레드 1번째 pop: 주소=0x7ffd89370d40, value=1
방해 스레드 2번째 pop: 주소=0x7ffd89370d50, value=2
희생자 스레드의 pop:   주소=0x7ffd89370d40, value=1
-> ABA 발생: 같은 노드(A)가 두 스레드에 각각 한 번씩, 총 두 번 pop됐다
---
(이하 4회 반복 모두 동일 -- 매번 "ABA 발생" 재현)
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 / `-O2` 실측, 5회 반복 모두 동일한 결과.) 방해 스레드의 1번째 pop과 희생자 스레드의 pop이 **완전히 같은 주소**를 돌려받았다 — 노드 A가 스택에서 두 번 나갔다. 방해 스레드는 A를 정상적으로 pop했고(재고에서 제거), 희생자 스레드도 자기 CAS가 성공했으니 A를 pop했다고 믿는다. 실제 자료구조라면 이건 같은 자원이 두 소비자에게 동시에 넘어간 것과 같다 — 스택이 "노드 하나는 한 번만 나간다"는 자기 불변식을 어긴 것이다.

::: danger TSan은 이 문제를 못 잡는다
`lf1_aba_repro.cpp`를 `g++ -fsanitize=thread`로 다시 컴파일해서 돌려도 결과는 동일하다 — 데이터 레이스 경고 없이, 종료 코드 0으로, 매번 조용히 통과한다. [6.5](#/atomic)에서 TSan이 `relaxed`의 위험을 정확히 잡아냈던 것과 대조적이다. 이유는 명확하다 — 여기엔 데이터 레이스가 없다. `head`, `stage`, `victim_result` 전부 원자적으로, 정해진 순서대로 정확히 접근됐다. 문제는 메모리 접근의 동기화가 아니라 **자료구조의 논리**다 — CAS가 "값이 같다"를 "상태가 안 바뀌었다"로 착각한 것이다. ABA는 UB도 아니고 데이터 레이스도 아니다. 컴파일러도 새니타이저도 잡아 주지 않는, 순수하게 알고리즘 설계의 결함이다.
:::

## 왜 위험한가 — 포인터 기반 자료구조에서

이 절의 재현은 노드를 `new`/`delete`로 만들지 않고 스택 변수 A, B를 그대로 재사용했다. 실전에서 락 없는 스택은 pop한 노드를 보통 힙에서 해제하거나 재활용 풀로 돌려보낸다 — 그리고 바로 이 지점에서 ABA가 단순한 "중복 지급" 이상의 사고로 커진다. 노드 A가 pop된 뒤 `delete`되고, 그 직후 다른 `new`가 마침 같은 주소를 다시 할당받아 완전히 다른 용도의 객체를 그 자리에 만들었다고 하자. 희생자 스레드의 CAS는 여전히 "head가 A와 같은 주소인가"만 확인하므로 성공한다 — 그런데 그 주소에 있는 건 이제 스택 노드가 아니라 전혀 다른 객체다. CAS가 성공한 순간 `old_head->next`를 읽는 코드는 남의 객체의 메모리를 스택의 다음 포인터로 잘못 해석해서 읽는다. use-after-free가 데이터 레이스 없이, 새니타이저 경고 없이 조용히 일어난다.

::: deep 실전에서는 이렇게 막는다
이 절은 ABA를 재현하고 왜 위험한지 보여주는 데까지만 다룬다. 실제 프로덕션 락 없는 자료구조는 다음 중 하나로 막는다: **태그된 포인터**(포인터 옆에 카운터를 붙여 포인터와 카운터를 한 번에 CAS하는 것 — x86-64는 128비트 `cmpxchg16b`로 이걸 지원한다. 카운터가 같이 바뀌므로 값이 같아 보여도 "몇 번째 A인지"가 달라 CAS가 실패한다), **해저드 포인터**(스레드가 지금 참조 중인 노드를 전역에 알려서, 다른 스레드가 그 노드를 실제로 해제하기 전에 반드시 확인하게 만든다), **에포크 기반 회수**(모든 스레드가 현재 접근 중인 "세대"를 표시해 두고, 가장 오래된 접근자가 다 지나간 뒤에야 실제로 메모리를 회수한다). 셋 다 이 노드 재사용 시점을 지연시키거나 CAS 자체가 재사용을 구분하게 만드는 전략이다 — 구현은 이 절의 스코프 밖이지만, 이름과 원리를 알아 두면 `boost::lockfree`나 `folly` 같은 실전 라이브러리의 코드를 읽을 때 "이게 왜 이렇게 복잡한가"가 이해된다.
:::

## SPSC 링 버퍼: atomic 인덱스 두 개로 만든 락 없는 큐

ABA는 "여러 스레드가 같은 포인터 변수 하나를 놓고 CAS로 경쟁"할 때 생기는 문제다. 그런데 락 없는 자료구조 중에는 애초에 CAS도, ABA도 필요 없는 부류가 있다 — **단일 생산자-단일 소비자(SPSC, Single Producer Single Consumer)** 큐다. 생산자 스레드 하나만 쓰고, 소비자 스레드 하나만 읽는다는 제약만 있으면, 고정 크기 배열과 `atomic<size_t>` 인덱스 두 개만으로 뮤텍스도 CAS도 없는 큐를 만들 수 있다.

```cpp title="lf2_spsc_queue.cpp — SPSC 링 버퍼"
#include <array>
#include <atomic>
#include <cstddef>

template <typename T, std::size_t Capacity>
class SpscRingBuffer {
public:
    bool try_push(const T& value) {
        const std::size_t w = write_idx_.load(std::memory_order_relaxed);
        const std::size_t next = (w + 1) % Capacity;
        if (next == read_idx_.load(std::memory_order_acquire)) {
            return false;   // 가득 참 -- read_idx_를 acquire로 읽어 소비자가 비운 슬롯을 본다
        }
        buffer_[w] = value;
        write_idx_.store(next, std::memory_order_release);   // 위의 buffer_[w] 쓰기가 먼저 보이게
        return true;
    }

    bool try_pop(T& out) {
        const std::size_t r = read_idx_.load(std::memory_order_relaxed);
        if (r == write_idx_.load(std::memory_order_acquire)) {
            return false;   // 비어 있음 -- write_idx_를 acquire로 읽어 생산자가 채운 슬롯을 본다
        }
        out = buffer_[r];
        read_idx_.store((r + 1) % Capacity, std::memory_order_release);
        return true;
    }

private:
    std::array<T, Capacity> buffer_{};
    std::atomic<std::size_t> write_idx_{0};   // 생산자만 쓴다
    std::atomic<std::size_t> read_idx_{0};    // 소비자만 쓴다
};
```

`write_idx_`/`read_idx_`에 걸린 `release`/`acquire`는 [6.5](#/atomic)의 `atm6_flag_acqrel.cpp`("작업 완료" 플래그로 `payload`를 안전하게 넘기던 패턴)와 정확히 같은 역할이다. 생산자가 `buffer_[w]`를 채운 뒤 `write_idx_`를 `release`로 갱신하면, 소비자가 그 값을 `acquire`로 읽었을 때 `buffer_[w]`의 내용도 함께 보이는 것이 보장된다 — 데이터 자체(`buffer_`)는 원자적이지 않은 평범한 배열인데도, 인덱스 하나의 release/acquire 짝이 그 옆의 비원자 데이터를 안전하게 실어 나른다.

실제로 여러 개를 넣고 순서대로 받는지 확인한다.

```cpp title="lf2_main.cpp — 생산자 20개 push, 소비자가 순서대로 pop"
constexpr int kItems = 20;

int main() {
    SpscRingBuffer<int, 8> q;   // 용량 8, 실제 저장 가능한 건 7개 -- 아래 note 참고

    std::thread producer([&] {
        for (int i = 0; i < kItems; ++i) {
            while (!q.try_push(i)) std::this_thread::yield();
        }
    });

    std::thread consumer([&] {
        int received = 0, value = 0;
        while (received < kItems) {
            if (q.try_pop(value)) {
                std::cout << "소비자가 받음: " << value
                          << (value == received ? " (순서 정확)" : " (!! 순서 어긋남 !!)") << "\n";
                ++received;
            } else {
                std::this_thread::yield();
            }
        }
    });
    producer.join();
    consumer.join();
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 lf2_spsc_queue.cpp -o lf2_spsc_queue -lpthread
$ ./lf2_spsc_queue
소비자가 받음: 0 (순서 정확)
소비자가 받음: 1 (순서 정확)
소비자가 받음: 2 (순서 정확)
...
소비자가 받음: 19 (순서 정확)
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra lf2_spsc_queue.cpp -o lf2_tsan -lpthread
$ ./lf2_tsan; echo "exit=$?"
소비자가 받음: 0 (순서 정확)
...
소비자가 받음: 19 (순서 정확)
exit=0
```

(g++ 13.3.0 실측, 5회 반복 모두 20개 전부 순서대로 수신, TSan 경고 0건.) 20개 전부 순서 그대로 들어왔고, TSan도 조용하다 — 뮤텍스도, CAS도, 단 한 줄의 락 관련 코드도 없이 두 스레드가 안전하게 데이터를 주고받았다.

::: note 용량 N이면 저장 가능한 건 N-1개다
`write_idx_ == read_idx_`는 "비어 있음"을 뜻한다. 그런데 링 버퍼가 꽉 찬 상태(N개를 다 채운 상태)에서도 `(w+1) % N` 연산으로 인덱스를 한 바퀴 돌리면 다시 `write_idx_ == read_idx_`가 될 수 있다 — 그러면 "가득 참"과 "비어 있음"을 구분할 방법이 없어진다. 그래서 이 구현은 슬롯 하나를 항상 비워 둬서 "꽉 찬 상태"를 `next == read_idx_`(한 칸 못 들어가는 상태)로 구분한다 — 용량 8을 선언하면 실제로 담을 수 있는 건 7개다. 별도 `size` 카운터를 하나 더 두는 방법도 있지만, 그러면 그 카운터도 두 스레드가 함께 갱신해야 해서 락 없는 설계의 단순함이 깨진다 — 슬롯 하나를 희생하는 쪽이 훨씬 싸다.
:::

## 왜 SPSC는 쉽고 MPMC는 어려운가

이 절의 `SpscRingBuffer`에는 CAS가 단 한 줄도 없다. 이유는 단순하다 — `write_idx_`는 오직 생산자 스레드만 쓰고, `read_idx_`는 오직 소비자 스레드만 쓴다. 한 변수를 갱신하는 스레드가 언제나 하나뿐이면, 그 갱신은 "값을 읽고 계산하고 다시 쓰는" 사이에 다른 누구도 같은 변수를 끼어들어 바꿀 수 없다 — 그러니 CAS로 "그 사이 안 바뀌었는지" 확인할 필요 자체가 없다. `load`와 `store`만으로 충분하고, 두 인덱스가 서로 다른 변수라 경합이라는 게 애초에 성립하지 않는다.

여러 생산자(MPMC, Multi Producer Multi Consumer)로 넓히는 순간 이 전제가 깨진다. 생산자가 둘이면 `write_idx_` 하나를 두 스레드가 동시에 갱신해야 한다 — 이제 CAS 루프로 "내가 쓸 슬롯 번호를 원자적으로 예약"해야 하고, 그 예약 자체가 [6.5](#/atomic)의 CAS 루프 패턴이다. 그런데 예약만으로 끝나지 않는다 — 생산자 A가 슬롯 5번을 예약하고, 생산자 B가 슬롯 6번을 예약했는데, A가 먼저 예약해 놓고 실제 `buffer_[5]`에 값을 쓰기 전에 스케줄러가 B를 먼저 실행시켜 `buffer_[6]`을 다 채워버리면, 소비자 입장에서 5번 슬롯은 아직 비어 있는데 6번 슬롯은 이미 채워진 상태를 마주하게 된다 — "예약 순서"와 "실제로 데이터가 준비되는 순서"가 어긋나는 것이다. 소비자가 여럿이면 대칭적으로 `read_idx_`에서 똑같은 문제가 반복된다. 게다가 포인터 기반 MPMC 자료구조(락 없는 큐, 락 없는 스택)는 이 절 앞부분의 ABA 문제까지 그대로 떠안는다 — 노드를 여러 생산자/소비자가 동시에 CAS로 다투기 때문이다.

::: warn MPMC를 직접 구현하지 마라
`boost::lockfree::queue`, `moodycamel::ConcurrentQueue` 같은 검증된 MPMC 구현체는 위에서 말한 슬롯 예약/완료 순서 문제와 ABA 문제를 각각 정교한 기법(순번 태그, 해저드 포인터, 백오프 전략)으로 막아 둔 결과물이다. 이 절에서 SPSC를 손으로 짠 것과 같은 감각으로 MPMC를 직접 구현하려 들지 마라 — 검증되지 않은 락 없는 MPMC 큐는 몇만 번에 한 번 재현되는 ABA/순서 버그를 안은 채 프로덕션에 들어갈 위험이 크다. 여러 생산자·소비자가 진짜로 필요하면 검증된 라이브러리를 쓰거나, 다음으로 미루고 뮤텍스 기반 큐([6.4](#/condvar))로 시작해라.
:::

## 성능 비교: SPSC 링 버퍼 vs 뮤텍스 + std::queue

SPSC 링 버퍼가 실제로 뮤텍스 기반 큐보다 얼마나 싼지 잰다. 두 구현 모두 생산자·소비자가 서로를 바쁜 대기(busy-wait)로 기다리는 동일한 조건에서, 2천만 개의 `long` 값을 한쪽 스레드가 넣고 다른 쪽이 빼는 데 걸리는 시간을 잰다.

```cpp title="lf3_bench.cpp — SPSC 링 버퍼 vs 뮤텍스 + std::queue (핵심부)"
double bench_spsc() {
    SpscRingBuffer<long, 1024> q;
    auto start = std::chrono::steady_clock::now();
    std::thread producer([&] {
        for (long i = 0; i < kN; ++i) while (!q.try_push(i)) std::this_thread::yield();
    });
    long sum = 0;
    std::thread consumer([&] {
        long value = 0;
        for (long i = 0; i < kN; ++i) { while (!q.try_pop(value)) std::this_thread::yield(); sum += value; }
    });
    producer.join(); consumer.join();
    return std::chrono::duration<double, std::nano>(
        std::chrono::steady_clock::now() - start).count() / kN;
}

double bench_mutex_queue() {
    std::queue<long> q; std::mutex m;
    auto start = std::chrono::steady_clock::now();
    std::thread producer([&] {
        for (long i = 0; i < kN; ++i) { std::lock_guard<std::mutex> lk(m); q.push(i); }
    });
    long sum = 0;
    std::thread consumer([&] {
        long received = 0;
        while (received < kN) {
            std::lock_guard<std::mutex> lk(m);
            if (!q.empty()) { sum += q.front(); q.pop(); ++received; }
        }
    });
    producer.join(); consumer.join();
    return std::chrono::duration<double, std::nano>(
        std::chrono::steady_clock::now() - start).count() / kN;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 lf3_bench.cpp -o lf3_bench -lpthread
$ ./lf3_bench
SPSC 링 버퍼:        26.3696 ns/아이템
뮤텍스 + std::queue: 93.0177 ns/아이템
뮤텍스가 SPSC보다 3.52747배 느림
```

(g++ 13.3.0 / `-O2` / 4코어 실측. 8회 반복에서 SPSC는 10.3~26.4ns, 뮤텍스는 68~95ns 사이로 흔들렸지만, 배율은 매번 2.7~7.4배 사이에서 **항상 뮤텍스가 더 느렸다.**) [6.5](#/atomic)에서 경합 있는 카운터 증가가 뮤텍스보다 atomic이 3배가량 쌌던 것과 같은 이유가 여기서도 반복된다 — `std::mutex`는 두 스레드가 거의 매번 부딪히는 상황(생산자·소비자가 쉬지 않고 큐를 두드림)에서 futex 대기 경로를 자주 타지만, `SpscRingBuffer`는 커널에 진입할 일이 전혀 없다 — 두 인덱스가 서로 다른 변수라서 애초에 "누가 먼저 락을 잡을지" 다툴 필요조차 없다.

::: perf 이 비교의 조건을 정확히 읽어라
이 실측은 "생산자·소비자가 쉬지 않고 최대 속도로 데이터를 주고받는" 조건이다. 실제 애플리케이션에서 큐가 대부분 비어 있고 아이템이 가끔만 들어온다면, 뮤텍스 기반 큐를 `condition_variable`과 함께 쓰는 쪽([6.4](#/condvar))이 CPU를 태우지 않고 대기할 수 있어 오히려 더 낫다 — 이 절의 두 구현은 둘 다 값이 없으면 `yield()`로 스핀하므로, 데이터가 뜸하게 오는 상황에서는 이 벤치마크가 재는 것과 다른 비용(빈 CPU 사이클 낭비)이 지배적이 된다. "SPSC가 항상 이긴다"가 아니라 "처리량이 최대치에 가깝게 몰릴 때 SPSC가 확실히 싸다"가 정확한 결론이다.
:::

## lock-free가 항상 빠른 건 아니다

지금까지의 실측만 보면 "락 없는 자료구조가 항상 이긴다"로 오해하기 쉽다. 그렇지 않다. 이 절 앞부분에서 본 ABA 문제, 그리고 노드 재사용 시점을 다루는 해저드 포인터·에포크 기반 회수 같은 기법은 전부 **설계와 구현 난이도가 뮤텍스 기반 코드보다 훨씬 높다.** 버그가 나면 재현이 어렵다 — 이 절의 `lf1_aba_repro.cpp`도 인위적으로 타이밍을 강제했기에 100% 재현됐지, 실전 코드의 ABA는 수백만 번에 한 번, 특정 부하 패턴에서만 나타나는 식으로 숨어 있는 경우가 많다. 새니타이저도 이걸 못 잡는다는 걸 이미 확인했다 — TSan은 데이터 레이스를 잡지, 자료구조의 논리적 불변식 위반을 잡지 않는다.

그러므로 원칙은 이렇다: **락 없는 자료구조는 락을 없앨 강력한 이유가 실제로 있을 때만 쓴다.** 강력한 이유의 예: 실시간 제어 루프가 락 때문에 커널 대기 큐에 들어가는 걸 절대 허용할 수 없는 경우([6.8 실시간 제약](#/realtime)), 시그널 핸들러 안에서는 뮤텍스 자체를 쓰는 게 금지돼 있는 경우(시그널 핸들러가 이미 락을 쥔 코드를 인터럽트하면 데드락이 된다). 이런 이유가 없다면, 뮤텍스 + `condition_variable`([6.4](#/condvar))로 충분하다 — 구현이 단순하고, 버그가 나도 재현과 디버깅이 훨씬 쉽고, 이 절의 실측이 보여주듯 경합이 심하지 않은 한 성능 차이도 크지 않다. "락 없이 짜면 더 빠를 것 같다"는 감이 아니라 구체적인 제약이 락 없는 설계를 요구할 때만 이 절의 도구를 꺼내라.

## 로보틱스 도메인: 실시간 제어 루프가 다른 스레드와 데이터를 주고받을 때

SPSC 링 버퍼가 정확히 들어맞는 자리가 로봇 소프트웨어 스택에 있다. 센서 드라이버가 별도 스레드(또는 인터럽트 핸들러에 가까운 콜백)에서 데이터를 계속 채워 넣고, 실시간 제어 루프 스레드가 그 데이터를 매 주기 소비하는 구조다 — 생산자 하나, 소비자 하나로 역할이 고정돼 있다는 점에서 이 절의 SPSC 조건과 정확히 일치한다. 제어 루프 쪽에서 뮤텍스를 걸면 [6.8 실시간 제약](#/realtime)이 금지하는 상황(락 경합으로 인한 지터, 최악의 경우 우선순위 역전)에 빠질 위험이 있다 — SPSC 링 버퍼는 제어 루프가 절대 블록되지 않게 하면서(값이 없으면 `try_pop`이 즉시 `false`를 돌려준다), 새 데이터가 왔을 땐 그 내용이 확실히 보이는 것(release/acquire)까지 함께 보장한다. `ros2_control`의 `hardware_interface`가 하드웨어 I/O 스레드와 제어 스레드를 분리하는 것도 이런 필요 때문이다 — [10.9 ros2_control과 hardware_interface](#/ros2-control)와 [6.9 스레드 아키텍처 설계](#/thread-architecture)에서 이 분리 구조를 실제로 설계해 본다.

::: interview "lock-free가 항상 더 안전하고 빠른가"
이렇게 물으면 "아니다"로 시작해야 한다. 안전성 측면에서는 오히려 반대다 — 뮤텍스는 데이터 레이스를 원천 차단하지만, 락 없는 알고리즘은 ABA처럼 새니타이저도 못 잡는 논리적 결함을 새로 만들어낼 여지가 있다(이 절의 `lf1_aba_repro.cpp`가 TSan을 조용히 통과하면서도 실제로는 노드를 중복 반환한 게 그 증거다). 성능 측면도 조건부다 — 경합이 심하지 않으면 뮤텍스와 큰 차이가 없고([6.5](#/atomic)의 경합 없음 실측), SPSC처럼 구조적으로 경합이 아예 없는 특수한 경우에만 락 없는 설계가 CAS조차 없이 뮤텍스보다 확실히 싸진다(이 절의 실측: 2.7~7.4배). 결론은 "락을 없앨 구체적이고 강력한 이유(실시간 제약, 시그널 핸들러)가 있을 때만 쓰고, 그렇지 않으면 뮤텍스가 기본값"이라는 것 — 이 원칙까지 말해야 완전한 답이다.
:::

## 요약

- CAS는 "지금 값이 아까 읽은 값과 같은가"만 확인한다. 그 사이 값이 A → B → A로 바뀌었어도 CAS는 구분하지 못한다 — 이게 ABA 문제다.
- ABA는 `stage` 신호로 두 스레드의 실행 순서를 강제해 100% 재현했다(실측: `lf1_aba_repro`, 5회 반복 모두 같은 노드가 두 번 pop됨). TSan은 이 문제를 잡지 못한다(실측: 경고 0건, 종료 코드 0) — ABA는 데이터 레이스가 아니라 자료구조 논리의 결함이기 때문이다.
- 실전에서 ABA는 pop된 노드가 해제되고 재사용될 때 use-after-free로 커진다. 태그된 포인터, 해저드 포인터, 에포크 기반 회수가 실제 해법이지만 이 절의 스코프 밖이다.
- SPSC(단일 생산자-단일 소비자) 링 버퍼는 `write_idx_`/`read_idx_`를 각각 한 스레드만 갱신하므로 CAS도, ABA도 필요 없다 — `load`/`store`에 release/acquire만 걸면 된다(실측: `lf2_spsc_queue`, 20개 전부 순서대로 수신, TSan 조용).
- MPMC는 여러 생산자가 같은 `write_idx_`를 CAS로 다퉈야 하고, 슬롯 예약 순서와 실제 데이터 완료 순서가 어긋날 수 있으며, 포인터 기반이면 ABA까지 떠안는다 — 검증된 라이브러리 없이 직접 구현할 대상이 아니다.
- 경합이 최대치로 몰린 조건에서 SPSC 링 버퍼는 뮤텍스 + `std::queue`보다 2.7~7.4배 쌌다(실측: `lf3_bench`, 대표값 26ns vs 93ns) — 이유는 커널 대기 경로 자체를 타지 않기 때문이다.
- lock-free는 항상 더 빠르거나 더 안전하지 않다. 락을 없앨 구체적이고 강력한 이유(실시간 제약, 시그널 핸들러)가 있을 때만 쓰고, 그렇지 않으면 뮤텍스가 기본값이다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·실행으로 확인하는 실습이다.

1. ABA 문제를 "CAS가 무엇을 확인하고, 무엇을 확인하지 못하는가"의 관점에서 한 문단으로 설명하라. 이 절의 `lf1_aba_repro.cpp`가 TSan을 조용히 통과하는 이유도 함께 써라.

2. 이 절의 `SpscRingBuffer`에는 CAS가 한 줄도 없다. 왜 SPSC에서는 CAS 없이 `load`/`store`만으로 충분한지, MPMC로 확장하면 왜 CAS(그리고 ABA 위험)가 다시 필요해지는지 설명하라.

3. (예측) `SpscRingBuffer::try_push`에서 `write_idx_.store(next, std::memory_order_release)`를 `std::memory_order_relaxed`로 바꾼다면(다른 건 그대로) 무슨 문제가 생길지 예측하고 근거를 써라. 힌트: [6.5](#/atomic)의 `atm7_flag_relaxed.cpp`가 어떤 문제를 일으켰는지 떠올려 봐라.

4. (실습, 코드 작성형) 이 절의 `SpscRingBuffer`를 직접 타이핑하고, `try_push`/`try_pop`을 이용해 생산자 스레드가 정수 1000개를 넣고 소비자 스레드가 순서대로 받아 합계를 계산하는 프로그램을 작성하라. `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra <파일> -o <출력> -lpthread`로 컴파일해서 TSan 경고가 없는지, 합계가 `1+2+...+1000`과 정확히 일치하는지 직접 확인하는 것이 성공 기준이다.
:::

::: answer 해설
1. CAS는 "현재 값이 내가 방금 지정한 기대값과 같은가"만 원자적으로 확인하고 같으면 새 값으로 바꾼다. 값이 그 사이에 A에서 B로, 다시 B에서 A로 바뀌어 결과적으로 "지금 값이 기대값과 같은" 상태가 됐다면, CAS는 그 중간 변화를 전혀 몰랐어도 성공한다 — 이게 CAS가 확인하지 못하는 부분이다. `lf1_aba_repro.cpp`에서 모든 메모리 접근(`head`, `stage`, `victim_result`)은 원자적이고 정확한 순서로 이뤄졌으므로 TSan이 감시하는 "동시 접근"은 실제로 없다. TSan은 메모리 접근의 동기화 여부를 검사하지, 자료구조가 "노드 하나는 한 번만 나가야 한다"는 논리적 불변식을 지켰는지는 검사하지 않는다.
2. `write_idx_`를 갱신하는 스레드가 생산자 하나뿐이므로, "값을 읽고 계산해서 다시 쓰는" 과정 사이에 다른 스레드가 같은 변수를 바꿀 가능성 자체가 없다 — CAS가 확인하려는 "그 사이 안 바뀌었는가"라는 질문이 성립하지 않는다. 생산자가 여럿이면 `write_idx_` 하나를 두 스레드가 동시에 갱신해야 하므로 "내가 예약한 슬롯이 아직 그대로인가"를 CAS로 확인해야 하고, 포인터 기반 자료구조라면 노드 재사용까지 겹쳐 ABA 위험이 되돌아온다.
3. `write_idx_`가 `relaxed`로 갱신되면, 소비자가 `write_idx_`의 새 값을 봤다는 사실이 더 이상 `buffer_[w]`에 쓴 값이 보인다는 것을 보장하지 않는다 — `atm7_flag_relaxed.cpp`에서 `ready`를 relaxed로 바꾸자 `payload`의 가시성 보장이 깨졌던 것과 완전히 같은 구조다. 소비자가 인덱스는 최신인데 그 슬롯의 실제 데이터는 아직 옛날 값(또는 쓰다 만 값)을 읽는 게 표준상 합법적인 결과가 된다 — TSan으로 재현하면 `buffer_[w]` 쓰기와 읽기 사이에서 데이터 레이스가 잡힌다.
4. `try_push`로 1000개를 넣고 `try_pop`으로 받아 합계를 누적하는 프로그램은 TSan 경고 없이 통과해야 하고, 합계는 `1000*1001/2 = 500500`과 정확히 일치해야 한다. 큐가 가득 찼을 때 `try_push`가 실패하면 `yield()` 뒤 재시도하는 루프가 필요하다는 것, 용량을 실제로 담을 개수보다 최소 1 크게 잡아야 한다는 것(이 절의 note 참고)까지 반영했다면 완전한 구현이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `lf1_aba_repro.cpp`는 5번 이상 반복 실행해서 매번 "ABA 발생"이 뜨는지, 그리고 `-fsanitize=thread`를 붙여도 조용히 통과하는지 두 눈으로 확인해야 "TSan이 전부 잡아주지 않는다"는 게 실감이 난다. 기준 명령: `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra main.cpp -o main -lpthread && ./main; echo "exit=$?"`.

**다음 절**: [6.7 async, future, promise](#/async-future) — 스레드를 직접 관리하는 대신 태스크 단위로 병렬성을 표현하는 방법을 다룬다.
