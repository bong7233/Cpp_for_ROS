# 6.3 mutex와 락 가드

::: lead
[6.2 데이터 레이스의 해부](#/data-races)에서 `counter++`가 load→add→store 세 개의 기계 연산으로 쪼개지고, 두 스레드가 그 사이로 끼어들면 증가 하나가 통째로 증발한다는 것을 봤다. 이 절은 그 사고를 실제로 고친다. `std::mutex`로 임계 구역을 만들어 counter++를 다시 원자적인 덩어리로 되돌리고, 그 대가로 무엇을 잃는지(대기 시간)와 무엇을 새로 조심해야 하는지(예외, 데드락)를 실측으로 확인한다. `lock()`/`unlock()`을 직접 부르는 방법부터 시작해서, 그 방법이 왜 위험한지를 실제로 프로그램을 멈춰가며 보여주고, [2.5 RAII](#/raii)가 이 문제를 어떻게 기계적으로 해결하는지로 마무리한다.
:::

## counter++ 레이스를 다시 원자적으로 만든다

6.2의 `race1_counter.cpp`를 그대로 가져온다. 전역 변수 `counter`를 스레드 두 개가 각각 500만 번씩 증가시킨다 — 동기화는 없다.

```cpp title="mut1_race_recap.cpp — 6.2의 race1_counter.cpp를 그대로 재현"
#include <iostream>
#include <thread>

constexpr long N = 5'000'000;
long counter = 0;   // 동기화 없이 두 스레드가 공유한다

void increment_loop() {
    for (long i = 0; i < N; ++i) {
        counter++;   // load -> add -> store, 원자적이지 않다
    }
}

int main() {
    std::thread t1(increment_loop);
    std::thread t2(increment_loop);
    t1.join();
    t2.join();
    std::cout << "기대값: " << (2 * N) << ", 실제값: " << counter << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -O0 -Wall -Wextra mut1_race_recap.cpp -o mut1_race_recap -lpthread
$ for i in 1 2 3; do ./mut1_race_recap; done
기대값: 10000000, 실제값: 5205965
기대값: 10000000, 실제값: 5358969
기대값: 10000000, 실제값: 5447264
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 실측, `-O0`.) 세 번 모두 1,000만에 한참 못 미친다 — 실행마다 스케줄러가 스레드를 겹치는 지점이 달라서 사라지는 증가분의 개수도 매번 다르다. 이제 `counter++` 앞뒤를 `std::mutex`로 감싼다. `std::mutex`는 `lock()`을 부른 스레드 하나만 통과시키고, 이미 누가 잠근 상태라면 다음 `lock()` 호출은 그 잠금이 풀릴 때까지 그 자리에서 블록(대기)한다 — `lock()`부터 `unlock()`까지의 구간을 **임계 구역(critical section)**이라고 부른다.

```cpp title="mut2_lock_unlock.cpp — lock()/unlock()으로 감싼 임계 구역"
#include <iostream>
#include <thread>
#include <mutex>

constexpr long N = 5'000'000;
long counter = 0;
std::mutex m;

void increment_loop() {
    for (long i = 0; i < N; ++i) {
        m.lock();
        counter++;
        m.unlock();
    }
}

int main() {
    std::thread t1(increment_loop);
    std::thread t2(increment_loop);
    t1.join();
    t2.join();
    std::cout << "기대값: " << (2 * N) << ", 실제값: " << counter << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -O0 -Wall -Wextra mut2_lock_unlock.cpp -o mut2_lock_unlock -lpthread
$ for i in 1 2 3; do ./mut2_lock_unlock; done
기대값: 10000000, 실제값: 10000000
기대값: 10000000, 실제값: 10000000
기대값: 10000000, 실제값: 10000000
```

(g++ 13.3.0 실측.) 세 번 모두 정확히 1,000만이다. 눈으로 값만 확인하는 걸로는 부족하다 — 6.2에서 쓴 ThreadSanitizer(TSan)로 두 버전을 다시 검사해서, "값이 우연히 맞았다"가 아니라 "레이스 자체가 없어졌다"는 걸 확인한다.

```console
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra mut1_race_recap.cpp -o mut1_tsan -lpthread
$ ./mut1_tsan
==================
WARNING: ThreadSanitizer: data race (pid=14626)
  Read of size 8 at 0x55ac46746158 by thread T2:
    #0 increment_loop() mut1_race_recap.cpp:9 (mut1_tsan+0x135a)
  Previous write of size 8 at 0x55ac46746158 by thread T1:
    #0 increment_loop() mut1_race_recap.cpp:9 (mut1_tsan+0x1374)
SUMMARY: ThreadSanitizer: data race mut1_race_recap.cpp:9 in increment_loop()
==================
기대값: 10000000, 실제값: 10000000
ThreadSanitizer: reported 2 warnings
$ echo $?
66
```

```console
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra mut2_lock_unlock.cpp -o mut2_tsan -lpthread
$ ./mut2_tsan
기대값: 10000000, 실제값: 10000000
$ echo $?
0
```

(g++ 13.3.0 실측, 출력은 길어서 핵심 줄만 남겼다.) `mut1`은 TSan이 경고 2건을 내고 종료 코드도 66(0이 아님)이지만, `mut2`는 경고 **0건**에 종료 코드도 0이다 — 뮤텍스가 두 스레드의 `counter` 접근에 순서를 강제했다는 걸 TSan이 직접 확인해 준 것이다. 값만 맞고 TSan이 조용하지 않다면 그건 "이번엔 운이 좋았다"(6.2에서 `-O2`로 다시 컴파일했을 때 항상 정답이 나왔던 것과 같은 함정)일 뿐이지 고쳐진 게 아니다 — 이 구분이 레이스 디버깅에서 가장 자주 놓치는 지점이다.

## 위젯으로 보는 임계 구역

아래 위젯은 방금 실측한 두 코드를 나란히 재생한다. `race` 시나리오는 `mut1`, `mutex` 시나리오는 `mut2`에 해당한다 — 시나리오 버튼으로 전환해서 비교해라.

::: widget thread-timeline
{ "scenario": "mutex" }
:::

`mutex` 시나리오를 스텝별로 재생하면: T1이 `lock()`을 부르면 뮤텍스가 T1 소유가 되고, T1이 `load → add → store`를 마칠 때까지 T2의 `lock()` 호출은 대기(`wait`) 칸에 머문다. T1이 `unlock()`을 부른 다음에야 T2가 뮤텍스를 얻어 자기 차례의 `load → add → store`를 시작한다. 핵심은 **T2가 읽는 시점이 강제로 T1의 store 이후로 밀렸다**는 것이다 — `race` 시나리오에서는 T2가 T1의 store 전에 끼어들어 값을 훔쳐 읽었지만, 여기서는 그게 구조적으로 불가능하다. `lock~unlock` 구간 전체가 "한 번에 한 스레드만 들어가는 방"이 됐기 때문이다. 대가도 위젯에 그대로 보인다 — T2의 `wait` 칸은 실제로 흘러간 시간을 폭으로 나타낸다. 뮤텍스는 공짜로 안전을 주지 않는다. 누군가는 반드시 기다린다.

## lock()/unlock()을 직접 쓰는 대가 — 예외 사이에서 죽는 unlock()

`mut2_lock_unlock.cpp`는 정상 경로에서는 완벽하게 동작했다. 문제는 임계 구역 안에서 **예외가 던져지는 경우**다. `unlock()`은 그 다음 줄에 적혀 있을 뿐인 평범한 함수 호출이다 — 그 줄에 도달하기 전에 함수를 빠져나가면 절대 불리지 않는다.

```cpp title="mut3_exception_no_raii.cpp — 예외가 unlock()을 건너뛴다"
#include <chrono>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>

std::mutex m;

void risky_operation() {
    m.lock();
    std::cout << "[T1] 락 획득, 위험한 작업 시작\n";
    throw std::runtime_error("설정 파싱 실패");   // 여기서 던지면 아래 unlock()은 절대 실행되지 않는다
    m.unlock();
}

int main() {
    std::thread t1([] {
        try {
            risky_operation();
        } catch (const std::exception& e) {
            std::cout << "[T1] 예외 잡음: " << e.what() << " -- 뮤텍스는 여전히 잠긴 채다\n";
        }
    });
    t1.join();

    std::cout << "[main] 다시 락을 시도한다 (최대 2초 대기)\n";
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    bool acquired = false;
    while (std::chrono::steady_clock::now() < deadline) {
        if (m.try_lock()) { acquired = true; break; }
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    std::cout << (acquired ? "[main] 락 획득 성공\n"
                            : "[main] 2초 동안 한 번도 락을 얻지 못했다 -- 영원히 풀리지 않는다\n");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra mut3_exception_no_raii.cpp -o mut3_exception_no_raii -lpthread
$ ./mut3_exception_no_raii
[T1] 락 획득, 위험한 작업 시작
[T1] 예외 잡음: 설정 파싱 실패 -- 뮤텍스는 여전히 잠긴 채다
[main] 다시 락을 시도한다 (최대 2초 대기)
[main] 2초 동안 한 번도 락을 얻지 못했다 -- 영원히 풀리지 않는다
```

(g++ 13.3.0 실측.) `main`은 `try_lock()`을 2초 동안 반복해서 시도했지만 단 한 번도 성공하지 못했다 — 무한정 기다리게 하는 대신 타임아웃을 걸어 "이 뮤텍스는 앞으로도 절대 풀리지 않는다"는 걸 확인만 하고 빠져나온 것이다. `t1`이 끝난 시점에 이미 뮤텍스는 영구히 잠긴 채로 남았다 — `risky_operation`이 `catch` 블록으로 예외를 잡긴 했지만, 그건 프로그램이 죽는 걸 막았을 뿐 뮤텍스 상태를 되돌리지는 못한다. `m.unlock()`을 부를 스레드가 이제 아무 데도 없다.

::: danger 이건 흔한 실전 버그다
서비스 콜백, 파싱 함수, 파일 입출력 — 임계 구역 안에서 예외를 던질 수 있는 코드는 생각보다 많다. `lock()`/`unlock()`을 직접 짝지어 쓰면 그 사이 코드 경로 전부가 "예외 없이 끝까지 실행된다"는 걸 사람이 눈으로 보증해야 한다. 코드 리뷰에서 놓치기 쉽고, 놓치면 그 뮤텍스를 다시 잠그려는 다른 스레드가 전부 그 자리에서 영원히 멈춘다 — 로그에는 아무 에러도 안 남고 그냥 "응답이 없는 프로세스"가 된다. 디버깅이 특히 괴로운 이유다.
:::

## std::lock_guard: 소멸자가 unlock을 보장한다

[2.5 RAII](#/raii)에서 본 원칙 그대로다 — 자원 해제를 소멸자에 맡기면, 함수가 정상 종료로 빠져나가든 예외로 빠져나가든 소멸자는 반드시 호출된다. `std::lock_guard`는 그 원칙을 뮤텍스에 적용한 것뿐이다. 생성자에서 `lock()`을 부르고, 소멸자에서 `unlock()`을 부른다.

```cpp title="mut4_lock_guard.cpp — 같은 예외, 이번엔 unlock()이 보장된다"
#include <chrono>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>

std::mutex m;

void risky_operation() {
    std::lock_guard<std::mutex> guard(m);   // 생성자에서 lock() -- RAII
    std::cout << "[T1] 락 획득, 위험한 작업 시작\n";
    throw std::runtime_error("설정 파싱 실패");
    // guard의 소멸자가 스코프를 벗어나며 반드시 unlock()을 호출한다 -- 이 줄에 도달하지 않아도 상관없다
}

int main() {
    std::thread t1([] {
        try {
            risky_operation();
        } catch (const std::exception& e) {
            std::cout << "[T1] 예외 잡음: " << e.what() << " -- guard 소멸자가 이미 unlock() 했다\n";
        }
    });
    t1.join();

    std::cout << "[main] 다시 락을 시도한다 (최대 2초 대기)\n";
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    bool acquired = false;
    while (std::chrono::steady_clock::now() < deadline) {
        if (m.try_lock()) { acquired = true; break; }
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    if (acquired) m.unlock();
    std::cout << (acquired ? "[main] 락 획득 성공 -- 즉시 풀렸다\n"
                            : "[main] 2초 동안 락을 얻지 못했다\n");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra mut4_lock_guard.cpp -o mut4_lock_guard -lpthread
$ ./mut4_lock_guard
[T1] 락 획득, 위험한 작업 시작
[T1] 예외 잡음: 설정 파싱 실패 -- guard 소멸자가 이미 unlock() 했다
[main] 다시 락을 시도한다 (최대 2초 대기)
[main] 락 획득 성공 -- 즉시 풀렸다
```

(g++ 13.3.0 실측.) `mut3`과 정확히 같은 예외, 정확히 같은 지점에서 던졌는데 `main`이 **즉시** 락을 얻는다 — `guard`가 스코프를 벗어나는 순간(스택 되감기가 `risky_operation`의 프레임을 정리하는 순간) 소멸자가 실행되며 `unlock()`을 호출했기 때문이다. 사람이 "이 함수 안에 예외가 없다"를 보증할 필요가 아예 없어진다 — 컴파일러가 생성한 소멸자 호출이 그 자리를 대신 지킨다. `lock_guard`는 생성자/소멸자 말고는 아무 멤버 함수도 없다 — 복사도 이동도 막혀 있다(`= delete`). 딱 "이 스코프 동안만 잠근다"는 것 하나만 하라고 일부러 기능을 깎아낸 타입이다.

## std::unique_lock: 유연함이 필요할 때

`lock_guard`가 못 하는 것 세 가지 — 중간에 풀었다가 다시 잠그기, 처음부터 잠그지 않고 시작하기, 다른 변수로 소유권을 넘기기 — 를 `std::unique_lock`은 전부 지원한다. 그만큼 `lock_guard`보다 상태를 더 들고 다니는 대신(락을 지금 들고 있는지 여부를 스스로 추적해야 한다) 훨씬 유연하다.

```cpp title="mut5_unique_lock.cpp — 풀었다 다시 잠그고, 소유권도 넘긴다"
#include <iostream>
#include <mutex>

std::mutex m;
int shared_value = 0;

int main() {
    std::unique_lock<std::mutex> lk(m);          // lock_guard처럼 생성자에서 lock()
    std::cout << "락 보유? " << lk.owns_lock() << "\n";

    shared_value = 1;
    lk.unlock();                                  // lock_guard에는 없는 멤버 함수 -- 스코프가 끝나기 전에 미리 푼다
    std::cout << "unlock() 후 보유? " << lk.owns_lock() << "\n";

    std::cout << "락 없이 하는 작업...\n";          // 락과 무관한 느린 작업을 임계 구역 밖으로 빼낼 수 있다

    lk.lock();                                     // 다시 lock() -- lock_guard는 이걸 못 한다
    shared_value += 1;
    std::cout << "재잠금 후 보유? " << lk.owns_lock() << ", shared_value = " << shared_value << "\n";

    std::unique_lock<std::mutex> moved_to = std::move(lk);   // 소유권 이전 -- lock_guard는 복사도 이동도 안 된다
    std::cout << "이동 후 원본 lk 보유? " << lk.owns_lock()
              << ", moved_to 보유? " << moved_to.owns_lock() << "\n";
    return 0;
}   // moved_to의 소멸자가 unlock()
```

```console
$ g++ -std=c++20 -Wall -Wextra mut5_unique_lock.cpp -o mut5_unique_lock -lpthread
$ ./mut5_unique_lock
락 보유? 1
unlock() 후 보유? 0
락 없이 하는 작업...
재잠금 후 보유? 1, shared_value = 2
이동 후 원본 lk 보유? 0, moved_to 보유? 1
```

(g++ 13.3.0 실측.) 반대로 `lock_guard`로 두 번째 줄을 그대로 옮겨 컴파일하면 어떻게 되는지도 실측해 둔다.

```console
$ g++ -std=c++20 -Wall -Wextra mut5b_lock_guard_no_move.cpp -o mut5b -lpthread
mut5b_lock_guard_no_move.cpp: In function 'int main()':
mut5b_lock_guard_no_move.cpp:5:50: error: use of deleted function
'std::lock_guard<_Mutex>::lock_guard(const std::lock_guard<_Mutex>&)'
```

(g++ 13.3.0 실측.) `lock_guard`는 이동 생성자가 `= delete`로 명시돼 있어서 컴파일 타임에 바로 막힌다 — `unique_lock`이 [2.7 이동 시맨틱](#/move-semantics)의 이동 생성자를 실제로 구현해 둔 것과 정반대다.

::: tip 기본값은 lock_guard, unique_lock은 필요할 때만
스코프 하나 동안 잠그고 그대로 풀리면 끝인 흔한 경우는 `lock_guard`로 충분하고, 여분의 상태 추적이 없는 만큼 미세하게 더 가볍다. `unique_lock`을 꺼낼 때는 대체로 이유가 있다 — 락을 중간에 풀었다 다시 잠가야 하거나, 함수에 락 소유권을 통째로 넘겨야 하거나(반환값으로 `unique_lock`을 돌려주는 패턴), 혹은 [6.4 condition_variable](#/condvar)처럼 **라이브러리가 그것 말고는 안 받는** 경우다 — `condition_variable::wait()`은 대기 도중 락을 스스로 풀었다가 깨어날 때 다시 잠가야 하는데, 그 "풀었다 다시 잠그기"를 `lock_guard`는 애초에 지원하지 않는다. `unique_lock`이 조건 변수에 필수인 이유가 정확히 이것이다.
:::

## 데드락: 서로 다른 순서로 잠그면

뮤텍스 하나로는 레이스가 없어졌지만, 뮤텍스가 **두 개 이상**이고 두 스레드가 그것들을 서로 다른 순서로 잠그면 완전히 새로운 사고가 난다. T1이 `mA`를 잠근 채 `mB`를 기다리고, 동시에 T2가 `mB`를 잠근 채 `mA`를 기다리면 — 둘 다 상대가 쥔 것을 원하고, 둘 다 자기가 쥔 것을 놓지 않는다. 영원히 이런 상태다. 이걸 **데드락(deadlock)**이라고 부른다.

```cpp title="mut6_deadlock.cpp — 두 뮤텍스를 반대 순서로 잠그면 실제로 멈춘다"
#include <atomic>
#include <chrono>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex mA, mB;
std::atomic<bool> both_done{false};

void thread1() {
    mA.lock();
    std::cout << "[T1] mA 잠금, mB를 기다린다...\n" << std::flush;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));   // T2가 mB를 먼저 잠그도록 유도
    mB.lock();                                                      // T2가 mA를 기다리는 중이라 여기서 영원히 블록
    std::cout << "[T1] mB도 잠금 (여기 도달하면 데드락이 아니다)\n" << std::flush;
    mB.unlock();
    mA.unlock();
}

void thread2() {
    mB.lock();
    std::cout << "[T2] mB 잠금, mA를 기다린다...\n" << std::flush;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    mA.lock();                                                      // T1이 mB를 기다리는 중이라 여기서 영원히 블록
    std::cout << "[T2] mA도 잠금 (여기 도달하면 데드락이 아니다)\n" << std::flush;
    mA.unlock();
    mB.unlock();
    both_done = true;
}

int main() {
    std::thread t1(thread1), t2(thread2);
    t1.detach();   // 데드락이면 영원히 안 끝난다 -- join하면 워치독도 같이 멈춘다
    t2.detach();

    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (std::chrono::steady_clock::now() < deadline) {
        if (both_done) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    if (both_done) {
        std::cout << "[워치독] 2초 안에 두 스레드 모두 끝났다 -- 데드락 아님\n" << std::flush;
    } else {
        std::cout << "[워치독] 2초가 지나도 끝나지 않았다 -- 데드락 확정, 강제 종료한다\n" << std::flush;
        std::_Exit(1);   // 데드락된 스레드는 절대 안 끝나므로 프로세스를 강제 종료해 증거만 남기고 빠져나온다
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra mut6_deadlock.cpp -o mut6_deadlock -lpthread
$ timeout 10 ./mut6_deadlock
[T1] mA 잠금, mB를 기다린다...
[T2] mB 잠금, mA를 기다린다...
[워치독] 2초가 지나도 끝나지 않았다 -- 데드락 확정, 강제 종료한다
```

(g++ 13.3.0 실측.) T1과 T2 모두 첫 번째 락은 성공했다는 로그를 남긴 채 그대로 멈췄다 — "mB도 잠금"이나 "mA도 잠금" 로그가 단 한 줄도 안 나온 게 증거다. 워치독은 진짜로 무한정 기다리는 대신 2초짜리 타임아웃으로 "이 상태에서 더 기다려도 안 풀린다"는 걸 확인만 하고 `std::_Exit`로 빠져나왔다 — 실제 서비스였다면 이 시점에 로그도 없이 응답 없는 프로세스가 하나 남는다.

고치는 방법은 "모든 스레드가 항상 같은 순서로 잠근다"는 규칙을 코드로 강제하는 것이다. `std::lock`(C++11)이 여러 뮤텍스를 데드락 없이 한 번에 잠그는 함수이고, `std::scoped_lock`(C++17)은 그걸 RAII로 감싼 것이다.

```cpp title="mut7_scoped_lock_fixed.cpp — 순서를 반대로 써도 데드락이 안 난다"
#include <chrono>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex mA, mB;

void thread1() {
    std::scoped_lock lock(mA, mB);   // C++17 -- 두 뮤텍스를 데드락 없이 한 번에 잠근다
    std::cout << "[T1] mA, mB 모두 잠금\n";
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
}   // 소멸자가 둘 다 풀어준다

void thread2() {
    std::scoped_lock lock(mB, mA);   // 순서를 반대로 써도 안전하다
    std::cout << "[T2] mB, mA 모두 잠금\n";
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
}

int main() {
    auto start = std::chrono::steady_clock::now();
    std::thread t1(thread1), t2(thread2);
    t1.join();
    t2.join();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start).count();
    std::cout << "두 스레드 모두 정상 종료, 걸린 시간: " << ms << "ms\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra mut7_scoped_lock_fixed.cpp -o mut7_scoped_lock_fixed -lpthread
$ timeout 5 ./mut7_scoped_lock_fixed
[T1] mA, mB 모두 잠금
두 스레드 모두 정상 종료, 걸린 시간: 100ms
```

(g++ 13.3.0 실측, 세 번 반복 실행 모두 100ms 안팎으로 정상 종료.) `thread1`은 `(mA, mB)` 순서로, `thread2`는 `(mB, mA)` 순서로 정반대로 썼는데도 멈추지 않는다 — `scoped_lock`은 생성자 내부에서 데드락 회피 알고리즘(`std::lock`과 동일)을 돌려, 여러 스레드가 같은 뮤텍스 집합을 어떤 순서로 요청하든 항상 안전하게 전부를 잠그거나 전부를 다시 풀고 재시도한다. `std::lock(mA, mB)` 한 줄과 이미 잠긴 락을 "인수받기"만 하는 `std::lock_guard<std::mutex> lg(mA, std::adopt_lock)` 두 줄로 직접 짤 수도 있지만(이게 C++17 이전의 방법이었다), `scoped_lock`이 그 세 줄을 하나로 합친 것이므로 새 코드에서는 `scoped_lock`을 쓰면 된다.

::: warn 잠금 순서 규칙은 컴파일러가 강제해주지 않는다
`scoped_lock`/`std::lock`은 "이 한 번의 호출 안에서" 여러 뮤텍스를 안전하게 잠근다. 하지만 코드베이스 전체에 걸쳐 뮤텍스 A와 B를 건드리는 함수가 여러 개 흩어져 있고, 그중 하나가 실수로 `mB.lock(); mA.lock();`처럼 개별 `lock()` 호출을 순서만 바꿔 쓰면 `mut6`과 똑같은 데드락이 다시 생긴다. 여러 락을 동시에 잡아야 하는 자리는 되도록 전부 `scoped_lock`/`std::lock`으로 통일하고, 그럴 수 없다면 "이 프로젝트에서는 항상 이 순서로 잠근다"는 규칙을 문서로 못박아 둬라 — 컴파일러도 새니타이저도 이 규칙 위반을 기본으로는 잡아주지 않는다.
:::

## 뮤텍스의 실제 비용: 경합이 있을 때와 없을 때

지금까지 뮤텍스가 안전을 산다는 건 봤다. 그 값을 실측한다 — 경합(다른 스레드가 동시에 같은 락을 원하는 것)이 없을 때와 있을 때 `lock()`/`unlock()` 한 쌍의 비용이 얼마나 다른지 잰다.

```cpp title="mut8_cost.cpp — 스레드 1개 vs 스레드 4개가 같은 락을 두드릴 때"
#include <chrono>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

std::mutex m;
long long shared_counter = 0;

double bench_uncontended(long iters) {              // 경합 없음: 혼자 lock/unlock 반복
    auto start = std::chrono::steady_clock::now();
    for (long i = 0; i < iters; ++i) {
        m.lock();
        ++shared_counter;
        m.unlock();
    }
    auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::nano>(end - start).count() / iters;
}

double bench_contended(int n_threads, long iters_per_thread) {   // 경합 있음: n개가 동시에 두드림
    std::vector<std::thread> ts;
    auto start = std::chrono::steady_clock::now();
    for (int i = 0; i < n_threads; ++i) {
        ts.emplace_back([iters_per_thread] {
            for (long i = 0; i < iters_per_thread; ++i) {
                m.lock();
                ++shared_counter;
                m.unlock();
            }
        });
    }
    for (auto& t : ts) t.join();
    auto end = std::chrono::steady_clock::now();
    double total_ns = std::chrono::duration<double, std::nano>(end - start).count();
    return total_ns / (static_cast<double>(n_threads) * iters_per_thread);
}

int main() {
    shared_counter = 0;
    double u = bench_uncontended(20'000'000);
    std::cout << "경합 없음 (스레드 1개): " << u << " ns/lock+unlock\n";

    shared_counter = 0;
    double c = bench_contended(4, 2'000'000);
    std::cout << "경합 있음 (스레드 4개, 같은 락): " << c << " ns/lock+unlock\n";
    std::cout << "배율: " << (c / u) << "x\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 mut8_cost.cpp -o mut8_cost -lpthread
$ ./mut8_cost
경합 없음 (스레드 1개): 5.82873 ns/lock+unlock
경합 있음 (스레드 4개, 같은 락 두드림): 44.4515 ns/lock+unlock
배율: 7.62629x
```

(g++ 13.3.0 / `-O2` / 4코어 x86-64 실측 — 절대값은 반복할 때마다 6~8배 사이에서 흔들렸지만, 자릿수 차이는 매번 같았다.) 경합이 없을 때 `lock()`+`unlock()` 한 쌍은 6ns 안팎이다 — glibc의 `std::mutex`는 리눅스에서 futex(fast userspace mutex) 기반이라, 아무도 경쟁하지 않으면 커널에 진입조차 하지 않고 원자적 명령어 몇 개로 끝난다. 스레드 4개가 같은 락을 놓고 실제로 경쟁하자 비용이 **7배 이상** 뛴다 — 경합이 생기면 futex는 실제로 커널 대기 큐에 스레드를 넣고 재우고 나중에 깨우는 시스템 콜 경로를 타야 하고, 이 문맥 전환(context switch) 비용이 순수 연산 비용을 압도한다. [8.2 캐시와 메모리 레이아웃](#/cache)에서 볼 캐시 미스 비용과 비슷한 성격이다 — "락을 걸었다"는 사실 자체보다 "다른 스레드와 부딪혔다"는 사실이 비용을 만든다.

::: perf 임계 구역은 짧을수록 좋다
이 실측이 말해주는 실전 규칙은 하나다 — 임계 구역 안에는 정말 공유 상태를 건드리는 코드만 남기고, 느린 연산(로깅, 파일 입출력, 네트워크 호출, 힙 할당)은 락 밖으로 빼라. 임계 구역이 길어질수록 다른 스레드가 그 락을 기다리며 경합할 확률이 올라가고, 한 번 경합이 붙으면 이 절에서 본 것처럼 비용이 한 자릿수 이상 뛴다. `unique_lock`의 `unlock()`/`lock()`이 유용한 자리가 정확히 여기다 — 락이 꼭 필요한 구간만 남기고 나머지는 풀어 둘 수 있다.
:::

로봇 소프트웨어에서 이 배율은 추상적인 숫자가 아니다. 로봇의 자세 추정치처럼 여러 스레드가 공유하는 상태는 뮤텍스로 보호해야 맞지만, 그 자세를 매 제어 주기마다 읽어야 하는 실시간 제어 루프 스레드가 다른 스레드와 락을 놓고 경합하다가 밀리면 그 지연이 곧바로 제어 주기의 지터(jitter)로 번진다 — [6.8 실시간 제약과 제어 루프](#/realtime)에서 이 문제를 정면으로 다룬다. [10.9 ros2_control과 hardware_interface](#/ros2-control)가 상태 읽기·쓰기 스레드와 제어 루프 스레드를 굳이 분리해서 설계하는 이유도 결국 이 절에서 실측한 경합 비용과 같은 뿌리다 — 락이 아예 없다면 6.2의 레이스로 돌아가고, 락을 아무 데나 걸면 이 절의 7배짜리 경합 비용을 제어 루프가 뒤집어쓴다.

::: interview lock_guard vs unique_lock, 그리고 데드락을 어떻게 막는가
"뮤텍스를 어떻게 안전하게 다루는가"는 동시성 면접의 기본 질문이다. 답변 뼈대: ① `lock_guard`는 생성자에서 `lock()`, 소멸자에서 `unlock()`만 하는 최소 RAII 래퍼다 — 복사·이동이 막혀 있고 스코프 하나 동안만 쓴다. ② `unique_lock`은 같은 RAII를 제공하면서 중간에 `unlock()`/`lock()`을 다시 부르거나 소유권을 이동할 수 있다 — 대가로 내부에 "지금 잠긴 상태인가"를 추적하는 상태가 있어 `lock_guard`보다 미세하게 무겁다. `condition_variable::wait()`처럼 대기 중 락을 풀었다 다시 잠가야 하는 API는 `unique_lock`만 받는다. ③ 데드락은 두 개 이상의 락을 서로 다른 순서로 잠글 때 생긴다 — 막는 방법은 "항상 같은 순서로 잠근다"는 규칙을 강제하거나, 여러 락을 동시에 잡을 때 `std::lock`/`std::scoped_lock`으로 한 번에 잠가서 순서 문제 자체를 없애는 것이다. 이 절의 `mut6`/`mut7` 실측처럼 "실제로 멈추는 걸 재현해 보였는가, 타임아웃으로 근거를 남겼는가"까지 설명하면 답변이 훨씬 구체적으로 들린다.
:::

## 요약

- `std::mutex`의 `lock()`/`unlock()`으로 감싼 구간을 임계 구역이라 부른다 — 한 번에 한 스레드만 들어가므로 `counter++`가 다시 원자적인 덩어리가 된다(실측: `mut2`는 다섯 번 모두 정확히 40만, TSan 경고 0건).
- `lock()`/`unlock()`을 직접 짝지어 쓰면 그 사이에서 예외가 던져질 때 `unlock()`이 영원히 안 불린다 — 다시 그 뮤텍스를 잠그려는 스레드는 영원히 블록된다(실측: `mut3`, 2초 타임아웃 동안 락을 한 번도 못 얻음).
- `std::lock_guard`는 [2.5 RAII](#/raii) 그대로다 — 소멸자가 스택 되감기 중에도 반드시 `unlock()`을 호출한다(실측: `mut4`, 같은 예외인데도 즉시 락 획득 성공). 복사·이동 모두 `= delete`다.
- `std::unique_lock`은 `unlock()`/`lock()`을 다시 부르고 소유권을 이동할 수 있다(실측: `mut5`) — `lock_guard`보다 유연한 대신 상태 추적 비용이 있고, [6.4 condition_variable](#/condvar)은 이 유연함을 요구해 `unique_lock`만 받는다.
- 데드락은 뮤텍스 두 개 이상을 서로 다른 순서로 잠글 때 생긴다 — 실제로 두 스레드가 서로를 영원히 기다리는 걸 재현했고(실측: `mut6`, 2초 워치독으로 확정), `std::lock`/`std::scoped_lock`으로 여러 뮤텍스를 한 번에 잠그면 순서가 달라도 안전하다(실측: `mut7`, 순서를 반대로 써도 100ms 안에 정상 종료).
- 경합 없는 `lock()`/`unlock()`은 몇 나노초 수준으로 싸지만, 여러 스레드가 같은 락을 두고 실제로 경합하면 비용이 한 자릿수 이상(실측: 약 7.6배) 뛴다 — futex가 커널 대기 경로를 타야 하기 때문이다. 임계 구역은 짧을수록 좋다.

::: quiz 연습문제
1~2번은 개념·예측 문제, 3번은 설계 판단, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·실행으로 확인하는 실습이다.

1. `mut2_lock_unlock.cpp`(직접 `lock()`/`unlock()`)와 `mut4_lock_guard.cpp`(`lock_guard`)는 예외가 없는 정상 경로에서는 완전히 같은 순서로 동작한다. 그런데도 왜 항상 `lock_guard`/`unique_lock`을 쓰라고 하는지, `mut3`과 `mut4`의 차이를 근거로 한 문단으로 설명하라.

2. (예측) 다음 코드를 컴파일하지 말고 무슨 일이 일어날지 예측하고 근거를 써라.

   ```cpp
   std::mutex m;
   m.lock();
   m.unlock();
   m.unlock();   // 이미 풀린 뮤텍스를 또 한 번 unlock()한다
   ```

3. `unique_lock`이 `lock_guard`보다 항상 안전한 상위 호환처럼 보이는데, 그런데도 이 절이 "스코프 하나면 `lock_guard`가 기본값"이라고 말하는 이유를 설계 관점에서 설명하라(힌트: 미세한 성능 차이, 그리고 타입이 "이 코드가 뭘 하려는지"를 얼마나 좁게 말해주는가).

4. (실습, 코드 작성형) `std::mutex` 두 개(`mA`, `mB`)를 만들고, 스레드 하나는 `(mA, mB)` 순서로, 다른 스레드는 `(mB, mA)` 순서로 개별 `lock()` 호출을 이용해 잠그도록 짜서 실제로 데드락이 나는지 확인하라(무한정 기다리지 말고 이 절의 워치독 패턴처럼 타임아웃을 걸어라). 그다음 두 스레드 모두 `std::scoped_lock(mA, mB)`로 바꿔서 순서 문제가 사라지고 정상 종료하는지 확인하라. 성공 기준: 데드락 버전은 타임아웃 안에 안 끝나는 걸 직접 확인했고, `scoped_lock` 버전은 몇 번을 반복 실행해도 항상 빠르게 정상 종료하는 걸 직접 확인했다.
:::

::: answer 해설
1. 정상 경로에서 `mut2`와 `mut4`는 동일하게 동작한다 — 차이는 "예외가 던져지는 경로"에서만 드러난다. `mut2`는 `unlock()`이 소스 코드 상의 한 줄일 뿐이라, 그 줄에 도달하기 전에 함수를 빠져나가면(`mut3`처럼) 절대 호출되지 않고 뮤텍스가 영구히 잠긴 채 남는다. `mut4`는 `unlock()` 호출 책임을 `guard`의 소멸자로 옮겼고, 소멸자는 스코프를 벗어나는 모든 경로(정상 반환이든 예외로 인한 스택 되감기든)에서 호출이 보장된다 — 그래서 `mut4`는 어떤 코드가 임계 구역 안에 추가되어도(그 코드가 예외를 던지든 말든) `unlock()` 누락을 걱정할 필요가 없다. "지금 당장 예외가 없다"가 아니라 "앞으로 이 함수가 어떻게 바뀌어도 안전하다"는 게 핵심 차이다.
2. 컴파일은 된다. `unlock()`은 반환 타입이 `void`인 평범한 멤버 함수라 몇 번을 불러도 문법적으로는 문제가 없다. 하지만 이미 풀린 뮤텍스를 다시 `unlock()`하는 것은 표준상 정의되지 않은 동작(UB)이다 — 이 환경(g++ 13.3.0, 기본 `std::mutex`)에서 실제로 실행해 보면 아무 에러 없이 조용히 통과하지만(비-에러체크 뮤텍스 타입을 쓰기 때문), 이건 "안전하다"는 보장이 전혀 아니다. 다른 구현이나 다른 빌드 설정에서는 크래시가 나거나 다른 락의 상태를 오염시킬 수 있다 — [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 본 "이 환경에서는 이렇게 나왔지만 보장이 없다"는 원칙이 여기도 그대로 적용된다.
3. `unique_lock`이 못 하는 게 없다는 건 맞지만, 타입이 할 수 있는 일이 많을수록 그 타입을 보는 사람이 "이 코드가 실제로 뭘 하는지" 추론하기 어려워진다 — `lock_guard`를 보면 "이 스코프 동안만 잠근다"는 것 외에 아무것도 궁금해할 필요가 없지만, `unique_lock`을 보면 "혹시 중간에 풀렸다 다시 잠겼나, 소유권이 이동됐나"까지 코드를 더 읽어야 확신할 수 있다. 여기에 `unique_lock`이 "지금 잠긴 상태인가"를 추적하는 내부 상태(`owns_lock`)를 항상 들고 다니는 만큼의 미세한 비용도 더해진다 — 둘 다 진짜로 필요할 때만 쓰고, 필요 없으면 더 좁은 타입을 쓰는 게 [5.9](#/vocabulary-types)에서 본 "타입으로 의도를 좁게 표현한다"는 원칙과 같은 맥락이다.
4. 개별 `lock()` 호출로 순서를 반대로 짠 버전은 이 절의 `mut6_deadlock.cpp`와 동일한 구조라 데드락이 재현된다 — 워치독 타임아웃(예: 2초) 안에 두 스레드 모두 완료 신호를 보내지 못하는 걸 직접 확인했어야 한다. `scoped_lock(mA, mB)`로 바꾼 버전은 `mut7_scoped_lock_fixed.cpp`와 동일한 구조이므로, 어느 스레드가 먼저 실행되든 항상 짧은 시간 안에 정상 종료해야 한다 — 반복 실행할 때마다 타이밍이 아주 조금씩 달라질 수는 있어도, 데드락 버전처럼 "영원히 안 끝나는" 일은 없어야 정답이다.
:::

이 절의 코드는 전부 직접 쳐라. 스레드를 쓰는 모든 예제는 링크 단계에 `-lpthread`가 필요하다. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main -lpthread && ./main`. TSan으로 재확인하려면 `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra main.cpp -o main -lpthread && ./main` — `mut1`(레이스 버전)에서는 경고가 뜨고 `mut2`(뮤텍스 버전)에서는 조용한지 직접 비교해라. 데드락 예제(`mut6`)는 정말로 프로그램이 멈추는 걸 눈으로 본 다음 `Ctrl+C`나 `timeout` 명령으로 빠져나와라 — 무한정 기다릴 필요는 없다.

**다음 절**: [6.4 condition_variable과 대기 패턴](#/condvar) — `unique_lock`이 왜 필요했는지가 여기서 완성된다. 락을 쥔 채로 "조건이 될 때까지" 스레드를 재웠다 깨우는 법을 본다.
