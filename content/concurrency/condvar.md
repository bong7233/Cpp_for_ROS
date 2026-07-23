# 6.4 condition_variable과 대기 패턴

::: lead
[6.3](#/mutex)은 `unique_lock`을 소개하면서 이렇게 예고했다 — "`condition_variable::wait()`은 대기 도중 락을 스스로 풀었다가 깨어날 때 다시 잠가야 하는데, 그 '풀었다 다시 잠그기'를 `lock_guard`는 애초에 지원하지 않는다." 이 절이 그 문장을 완성한다. "조건이 될 때까지 스레드를 재운다"는 문제를 뮤텍스만으로 억지로 풀면 CPU를 실측으로 확인 가능한 수준까지 낭비하는 폴링이 된다는 것부터 보고, `std::condition_variable`이 그 낭비를 없애는 대신 새로 짊어져야 할 세 가지 함정 — `lock_guard`로는 아예 컴파일이 안 되는 이유, 허위 기상, 유실된 알림 — 을 전부 실제 코드와 실제 컴파일러 출력으로 확인한다. 마지막은 생산자-소비자 큐, 로봇 소프트웨어에서 가장 자주 마주치는 대기 패턴이다.
:::

## 폴링으로 기다리면 CPU가 쉬지 않는다

"생산자 스레드가 데이터를 준비할 때까지 소비자 스레드가 기다린다"는 요구를 지금까지 배운 도구(뮤텍스, 평범한 `bool` 플래그)만으로 짜면 이렇게 된다 — 조건을 반복해서 확인하는 루프, 즉 폴링(polling)이다.

```cpp title="cv1_poll_busy.cpp — 뮤텍스로 감싼 조건을 계속 확인만 한다"
#include <chrono>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex m;
bool ready = false;
long long spin_count = 0;

void producer() {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    std::lock_guard<std::mutex> lg(m);
    ready = true;
}

void consumer_poll() {
    while (true) {
        m.lock();
        bool r = ready;
        m.unlock();
        if (r) break;
        ++spin_count;   // 조건이 거짓이면 곧바로 또 확인한다 -- 그 사이 CPU를 놀리지 않는다
    }
}

int main() {
    std::thread t1(producer);
    std::thread t2(consumer_poll);
    t1.join();
    t2.join();
    std::cout << "폴링 루프가 도는 동안 확인한 횟수: " << spin_count << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -O2 -Wall -Wextra cv1_poll_busy.cpp -o cv1_poll_busy -lpthread
$ /usr/bin/time -v ./cv1_poll_busy
폴링 루프가 도는 동안 확인한 횟수: 18799251
	User time (seconds): 0.44
	System time (seconds): 0.00
	Percent of CPU this job got: 89%
	Elapsed (wall clock) time (h:mm:ss or m:ss): 0:00.50
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 실측, `-O2`.) 생산자가 조건을 세우기까지 500ms를 기다리는 동안, 소비자 스레드는 `lock() → 읽기 → unlock()`을 **1,879만 번** 반복했다 — 그리고 `/usr/bin/time -v`가 재는 CPU 사용률은 전체 500ms 동안 **89%**다. 이 프로그램이 실제로 유용한 일을 한 시간은 0초다. 500ms 내내 코어 하나를 거의 통째로 "아직 준비 안 됐나요?"를 되묻는 데 태웠을 뿐이다. 스레드 하나가 이 정도면, 로봇 프로세스 안에 이런 대기가 여러 개 있으면 코어를 계속 잡아먹는 스레드가 그만큼 늘어난다 — 정작 그 코어를 써야 할 계획 스레드나 다른 노드의 콜백은 그만큼 밀린다.

`sleep_for`를 폴링 루프 안에 끼워 넣어 확인 빈도를 낮추는 절충안도 있지만, 그건 두 가지 다른 방식으로 나쁘다 — 너무 자주 자면(예: 1ms) CPU 낭비가 조금 줄 뿐 여전히 낭비고, 너무 뜸하게 자면(예: 100ms) 조건이 이미 충족된 후에도 다음 확인 시점까지 최대 100ms를 헛되이 흘려보낸다. 정확히 조건이 바뀌는 순간 즉시 깨어나면서 그 전에는 CPU를 전혀 안 쓰는 방법이 필요하다 — `std::condition_variable`이 정확히 이 문제를 위해 있다.

## condition_variable: 스레드를 재우고 정확한 순간에 깨운다

`std::condition_variable::wait(lock)`은 딱 세 가지 일을 한 번에, 원자적으로 한다. **(1)** 들고 있던 락을 풀고, **(2)** 그 스레드를 잠재우고(운영체제 수준에서 진짜로 재운다 — CPU를 안 쓴다), **(3)** 다른 스레드가 같은 조건 변수에 `notify_one()`이나 `notify_all()`을 부르면 깨어나서 **락을 다시 잡은 다음에야** `wait()`에서 반환한다. "락을 풀고 재우는 것"과 "깨어나서 락을 다시 잡는 것" 사이에 다른 스레드가 끼어들 틈이 없다는 게 핵심이다 — 그 틈이 있었다면 락을 풀고 아직 잠들기 전 사이에 조건이 이미 바뀌어 버리는 경우를 코드가 따로 처리해야 했을 것이다.

같은 문제를 `condition_variable`로 다시 짠다. `cv1`과 똑같이 500ms 뒤 `ready`를 세우는 생산자, 그 조건을 기다리는 소비자다.

```cpp title="cv2_condvar_wait.cpp — 같은 시나리오, 폴링 없이 기다린다"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex m;
std::condition_variable cv;
bool ready = false;

void producer() {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    {
        std::lock_guard<std::mutex> lg(m);
        ready = true;
    }
    cv.notify_one();   // 조건을 다 세운 뒤에 알린다
}

void consumer_wait() {
    std::unique_lock<std::mutex> lk(m);
    cv.wait(lk, [] { return ready; });   // ready가 참일 때까지 CPU 없이 잔다
}

int main() {
    std::thread t1(producer);
    std::thread t2(consumer_wait);
    t1.join();
    t2.join();
    std::cout << "condition_variable로 깨어났다\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -O2 -Wall -Wextra cv2_condvar_wait.cpp -o cv2_condvar_wait -lpthread
$ /usr/bin/time -v ./cv2_condvar_wait
condition_variable로 깨어났다
	User time (seconds): 0.00
	System time (seconds): 0.00
	Percent of CPU this job got: 0%
	Elapsed (wall clock) time (h:mm:ss or m:ss): 0:00.50
```

(g++ 13.3.0 실측.) 걸린 시간은 `cv1`과 똑같이 500ms다 — 조건이 실제로 충족되는 시점은 바뀌지 않았으니 당연하다. 그런데 CPU 사용률은 **89% → 0%**다. `wait()`에 들어간 소비자 스레드는 커널이 관리하는 대기 큐로 완전히 빠져서 스케줄러가 아예 실행 대상에서 제외한다 — 폴링 루프의 "확인하고, 확인하고, 또 확인하는" 1,879만 번의 반복이 통째로 사라졌다. `notify_one()`이 불리는 순간 커널이 그 스레드를 깨워 실행 큐에 다시 올려놓는다. 정확히 필요한 순간에만 깨어나고, 그 전에는 자원을 하나도 안 쓴다는 게 이 절이 실측으로 보여주려는 첫 번째 사실이다.

`cv.wait(lk, [] { return ready; })`처럼 두 번째 인자로 술어(predicate)를 넘기는 이 형태가 사실은 아래 while 루프의 축약형이다 — 표준이 그렇게 정의한다.

```cpp
// cv.wait(lk, pred); 는 정확히 이것과 같다:
while (!pred())
    cv.wait(lk);
```

왜 딱 `if`가 아니라 `while`(혹은 그 축약형인 술어 버전)이어야 하는지는 이 절 뒤쪽(허위 기상, 유실된 알림)에서 실제로 잘못된 코드를 컴파일·실행해서 확인한다.

## 생산자-소비자 큐: 실전에서 가장 흔한 형태

`bool` 플래그 하나만 기다리는 예제는 원리를 보여주기엔 좋지만, 실전에서는 대개 "큐에 항목이 쌓일 때까지 기다렸다가, 쌓이면 꺼내서 처리하고, 다시 기다린다"는 반복 구조다. 생산자 하나, 소비자 하나로 이 패턴을 완전한 코드로 짠다.

```cpp title="cv3_producer_consumer.cpp — 큐 기반 생산자-소비자"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <queue>
#include <thread>

std::mutex m;
std::condition_variable cv;
std::queue<int> q;
bool done = false;   // 생산자가 더 이상 넣을 게 없다는 신호

void producer() {
    for (int i = 1; i <= 5; ++i) {
        {
            std::lock_guard<std::mutex> lg(m);
            q.push(i);
            std::cout << "[생산자] " << i << " 넣음 (큐 크기 " << q.size() << ")\n";
        }
        cv.notify_one();   // 항목 하나 넣을 때마다 알린다
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
    }
    {
        std::lock_guard<std::mutex> lg(m);
        done = true;
    }
    cv.notify_one();   // 종료 신호도 같은 조건 변수로 알린다
}

void consumer() {
    while (true) {
        std::unique_lock<std::mutex> lk(m);
        cv.wait(lk, [] { return !q.empty() || done; });   // 꺼낼 게 있거나 끝났을 때만 깨어난다
        while (!q.empty()) {
            int v = q.front();
            q.pop();
            lk.unlock();                         // 출력처럼 느린 작업은 락 밖에서 한다
            std::cout << "  [소비자] " << v << " 꺼냄\n";
            lk.lock();
        }
        if (done && q.empty()) break;
    }
    std::cout << "[소비자] 종료\n";
}

int main() {
    std::thread t1(producer), t2(consumer);
    t1.join();
    t2.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -O2 -Wall -Wextra cv3_producer_consumer.cpp -o cv3_producer_consumer -lpthread
$ ./cv3_producer_consumer
[생산자] 1 넣음 (큐 크기 1)
  [소비자] 1 꺼냄
[생산자] 2 넣음 (큐 크기 1)
  [소비자] 2 꺼냄
[생산자] 3 넣음 (큐 크기 1)
  [소비자] 3 꺼냄
[생산자] 4 넣음 (큐 크기 1)
  [소비자] 4 꺼냄
[생산자] 5 넣음 (큐 크기 1)
  [소비자] 5 꺼냄
[소비자] 종료
```

(g++ 13.3.0 실측, 반복 실행 두 번 모두 순서·개수 동일.) `wait(lk, pred)`가 매번 정확히 큐에 뭔가 있거나 `done`이 설 때까지만 잠재우고, 그 사이 소비자는 CPU를 전혀 쓰지 않는다. 안쪽 `while (!q.empty())` 루프에서 `lk.unlock()`/`lk.lock()`을 다시 부르는 게 눈에 띈다 — 이게 [6.3](#/mutex)의 "임계 구역은 짧을수록 좋다"는 원칙을 그대로 실천한 것이다. `std::cout` 출력처럼 느리고 공유 상태와 무관한 작업을 락을 쥔 채로 하면 그동안 생산자가 큐에 새 항목을 넣으려는 `lock_guard`가 불필요하게 대기해야 한다 — `unique_lock`이 여기서도 이 유연함(잠깐 풀었다 다시 잠그기)을 제공하기 때문에 가능한 최적화다. ThreadSanitizer로도 재확인한다.

```console
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra cv3_producer_consumer.cpp -o cv3_tsan -lpthread
$ ./cv3_tsan; echo "exit=$?"
...
[소비자] 종료
exit=0
```

(g++ 13.3.0 실측.) 경고 0건, 종료 코드 0 — `q`와 `done`에 대한 두 스레드의 접근이 뮤텍스와 조건 변수를 통해 순서가 강제된다는 걸 TSan이 확인해 준다.

## 왜 unique_lock만 받는가 — lock_guard를 넘기면 컴파일 자체가 안 된다

[6.3](#/mutex)에서 예고했던 대목이다. `wait()`는 대기 직전에 락을 스스로 풀고, 깨어난 뒤 다시 잠가야 한다 — "지금 이 락을 내가 들고 있는지"를 스스로 추적하지 못하는 타입은 이 일을 할 수 없다. `lock_guard`가 정확히 그런 타입이다: 생성자에서 잠그고 소멸자에서 푸는 것 말고는 아무 멤버 함수도 없다. 실제로 넘겨서 확인한다.

```cpp title="cv4_lock_guard_wait_error.cpp — lock_guard를 wait()에 넘긴다"
#include <condition_variable>
#include <mutex>

std::mutex m;
std::condition_variable cv;

int main() {
    std::lock_guard<std::mutex> lg(m);
    cv.wait(lg);   // lock_guard를 넘긴다 -- 컴파일이 되면 안 된다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra cv4_lock_guard_wait_error.cpp -o cv4_lock_guard_wait_error -lpthread
cv4_lock_guard_wait_error.cpp: In function 'int main()':
cv4_lock_guard_wait_error.cpp:9:12: error: no matching function for call to
'std::condition_variable::wait(std::lock_guard<std::mutex>&)'
    9 |     cv.wait(lg);
      |     ~~~~~~~^~~~
/usr/include/c++/13/condition_variable:98:5: note: candidate:
'void std::condition_variable::wait(std::unique_lock<std::mutex>&)'
   98 |     wait(unique_lock<mutex>& __lock);
      |     ^~~~
/usr/include/c++/13/condition_variable:98:30: note: no known conversion for
argument 1 from 'std::lock_guard<std::mutex>' to 'std::unique_lock<std::mutex>&'
```

(g++ 13.3.0 실측.) 에러는 명확하다 — `wait()`의 시그니처 자체가 `std::unique_lock<std::mutex>&`만 받는다. `lock_guard`에서 `unique_lock`으로 가는 암묵적 변환 경로가 아예 없으니 오버로드 해석이 후보를 하나도 못 찾고 그 자리에서 실패한다. 런타임에 이상하게 도는 게 아니라 **컴파일 타임에** 막힌다는 게 중요하다 — "이 락은 나중에 스스로 풀었다 다시 잠글 일이 있다"는 사실을 컴파일러가 타입만 보고 강제하는 것이다. `lock_guard`가 스코프 하나짜리 단순한 잠금에 딱 맞는 만큼, `condition_variable`처럼 락의 상태를 스스로 관리해야 하는 자리에는 원천적으로 못 들어온다.

::: deep 내부적으로는 무슨 일이 일어나는가
`wait(lk)`는 리눅스 glibc 구현에서 결국 `pthread_cond_wait()`을 호출하고, 그 함수가 뮤텍스 해제와 스레드를 재우는 것(futex 대기 큐 진입)을 커널 시스템 콜 하나 안에서 원자적으로 처리한다. `unique_lock`은 이 호출 전후로 자신의 내부 상태(`owns_lock`)를 갱신하는 얇은 래퍼일 뿐이고, 실제 "풀고 자고 깨서 다시 잠근다"는 일은 POSIX 스레드 라이브러리와 커널이 한다. `lock_guard`가 이 API에 못 들어가는 건 단지 필요한 멤버 함수(`unlock()`/`lock()`)가 타입에 없어서다 — 기능이 부족해서 못 하는 것이지 원리적으로 불가능한 게 아니다.
:::

## 허위 기상: notify 없이도 깨어날 수 있다

C++ 표준은 `wait()`가 **아무도 `notify`를 부르지 않았는데도 깨어날 수 있다**는 것을 명시적으로 허용한다 — 이걸 허위 기상(spurious wakeup)이라 부른다. POSIX `pthread_cond_wait`의 구현 방식(신호 전달, 내부 경쟁 상태 회피 로직 등)이 이런 여분의 깨어남을 만들 수 있다는 게 이유다.

::: warn 이 환경에서 진짜 허위 기상을 강제로 재현하지는 못했다
글리bc NPTL 기반의 이 환경(Ubuntu 24.04, 커널 기본 설정)에서 "notify를 정말 한 번도 안 불렀는데 wait()가 저절로 깨어나는" 상황을 결정적으로 재현하는 건 이 절에서 시도하지 않았다 — 실제로 일어나긴 하지만 특정 신호 타이밍에 의존해 재현 조건을 통제하기 어렵다. 대신 아래는 **깨어났는데 조건이 아직 거짓인 상황**을 실제로 만들어서 확인한다. 원인이 진짜 허위 기상이든, 다른 대기자가 먼저 조건을 가로챈 것이든, 코드가 반드시 견뎌야 하는 결과는 똑같다 — "깨어남 = 조건이 참"이 아니라는 것.
:::

`if`로 딱 한 번만 확인하고 넘어가는 버전과, 술어로 다시 확인하는 버전을 나란히 만든다. 진짜 조건(`ready`)이 아직 거짓인 시점에 일부러 `notify_one()`을 한 번 먼저 보내서 — "조건과 무관한 깨움"을 흉내낸다.

```cpp title="cv5a_if_wrong.cpp — if로 한 번만 확인한다 (틀린 코드)"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex m;
std::condition_variable cv;
bool ready = false;
int shared_value = -1;

void faulty_consumer() {
    std::unique_lock<std::mutex> lk(m);
    if (!ready)                  // ❌ 조건을 딱 한 번만 확인한다
        cv.wait(lk);
    std::cout << "[if 버전] 깨어남 -- ready=" << ready
              << ", shared_value=" << shared_value << "\n";
}

int main() {
    std::thread consumer(faulty_consumer);

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    std::cout << "[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)\n";
    cv.notify_one();   // 진짜 조건과 무관한 알림 -- 허위 기상과 관측 결과가 동일하다

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    {
        std::lock_guard<std::mutex> lg(m);
        ready = true;
        shared_value = 42;
    }
    std::cout << "[메인] 진짜 조건을 세우고 다시 알린다\n";
    cv.notify_one();

    consumer.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra cv5a_if_wrong.cpp -o cv5a_if_wrong -lpthread
$ for i in 1 2 3; do ./cv5a_if_wrong; echo "==="; done
[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)
[if 버전] 깨어남 -- ready=0, shared_value=-1
[메인] 진짜 조건을 세우고 다시 알린다
===
[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)
[if 버전] 깨어남 -- ready=0, shared_value=-1
[메인] 진짜 조건을 세우고 다시 알린다
===
[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)
[if 버전] 깨어남 -- ready=0, shared_value=-1
[메인] 진짜 조건을 세우고 다시 알린다
===
```

(g++ 13.3.0 실측, 세 번 반복 모두 동일하게 재현.) 소비자가 첫 번째 `notify_one()`만으로 곧바로 깨어나 버렸다 — `ready`는 여전히 `0`(false), `shared_value`는 아직 초기값 `-1`이다. `if`는 "지금 이 순간 조건을 확인하고, 거짓이면 딱 한 번 자고, 깨어나면 무조건 참이라고 믿는다"는 코드다. 그 믿음이 틀렸다. 이제 술어를 쓰는 버전으로 정확히 같은 알림 순서를 준다.

```cpp title="cv5b_predicate_correct.cpp — wait(lk, predicate)로 다시 확인한다"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex m;
std::condition_variable cv;
bool ready = false;
int shared_value = -1;

void correct_consumer() {
    std::unique_lock<std::mutex> lk(m);
    cv.wait(lk, [] { return ready; });   // 깨어나도 ready가 거짓이면 그대로 다시 잔다
    std::cout << "[predicate 버전] 깨어남 -- ready=" << ready
              << ", shared_value=" << shared_value << "\n";
}

int main() {
    std::thread consumer(correct_consumer);

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    std::cout << "[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)\n";
    cv.notify_one();

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    {
        std::lock_guard<std::mutex> lg(m);
        ready = true;
        shared_value = 42;
    }
    std::cout << "[메인] 진짜 조건을 세우고 다시 알린다\n";
    cv.notify_one();

    consumer.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra cv5b_predicate_correct.cpp -o cv5b_predicate_correct -lpthread
$ for i in 1 2 3; do ./cv5b_predicate_correct; echo "==="; done
[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)
[메인] 진짜 조건을 세우고 다시 알린다
[predicate 버전] 깨어남 -- ready=1, shared_value=42
===
[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)
[메인] 진짜 조건을 세우고 다시 알린다
[predicate 버전] 깨어남 -- ready=1, shared_value=42
===
[메인] '조건 없는' 알림을 보낸다 (ready는 여전히 false)
[메인] 진짜 조건을 세우고 다시 알린다
[predicate 버전] 깨어남 -- ready=1, shared_value=42
===
```

(g++ 13.3.0 실측, 세 번 반복 모두 동일하게 재현.) 첫 번째 `notify_one()`이 왔을 때 술어(`ready == true`)를 확인해 보고 여전히 거짓이라 다시 잠들었다 — "[predicate 버전]" 로그 줄 자체가 두 번째 알림 이후에야 찍힌다. `ready=1, shared_value=42`, 항상 옳은 값이다. `if` 버전과 코드 차이는 딱 한 줄뿐인데(조건문을 `while`이나 술어로 바꾼 것) 결과는 "틀린 값을 조용히 읽는 버그"와 "항상 옳은 값만 읽는 코드"로 갈린다.

::: danger 이 버그는 로그에 에러를 남기지 않는다
`if`로만 확인하는 버전이 위험한 진짜 이유는 크래시하지 않는다는 것이다 — 컴파일도 되고, 대부분의 타이밍에서는 우연히 조건이 이미 참이 된 뒤에 깨어나서 정상처럼 보인다. 문제가 되는 건 "깨어남"과 "조건 충족" 사이에 어떤 이유로든 시간차가 벌어지는 드문 순간뿐이다 — 부하가 높아 스케줄러가 늦게 반응할 때, 다른 스레드가 먼저 자원을 가로챌 때, 혹은 진짜 허위 기상이 일어날 때. 그 순간에만 오래된 값을 조용히 읽고 다음 코드로 넘어간다. 재현 안 되는 버그 리포트의 상당수가 이 패턴에서 나온다.
:::

## lost wakeup: notify가 wait보다 먼저 오면 사라진다

허위 기상과 정반대 방향의 문제도 있다 — `notify_one()`을 부르는 시점에 그 신호를 받을 스레드가 아직 `wait()`에 진입조차 안 했다면, 그 알림은 그냥 사라진다. `condition_variable`은 "지나간 알림"을 기억해 뒀다가 나중에 오는 `wait()`에 돌려주지 않는다 — 알림은 신호이지, 세워지는 깃발이 아니다.

```cpp title="cv6_lost_wakeup_bare.cpp — 조건 플래그 없이 notify 신호만 믿는다"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex m;
std::condition_variable cv;   // 조건 상태가 아예 없다 -- notify 신호 자체만 믿는다

int main() {
    std::cout << "[메인] 아직 아무도 기다리지 않는 시점에 notify_one() 호출\n";
    cv.notify_one();   // 이 순간 wait() 중인 스레드가 없다 -- 신호는 그냥 사라진다

    std::thread consumer([] {
        std::unique_lock<std::mutex> lk(m);
        std::cout << "[소비자] wait_for 진입 (최대 2초)\n";
        auto status = cv.wait_for(lk, std::chrono::seconds(2));
        std::cout << (status == std::cv_status::timeout
                      ? "[소비자] 2초 타임아웃 -- 그 notify는 못 받았다\n"
                      : "[소비자] notify로 깨어남\n");
    });
    consumer.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra cv6_lost_wakeup_bare.cpp -o cv6_lost_wakeup_bare -lpthread
$ time ./cv6_lost_wakeup_bare
[메인] 아직 아무도 기다리지 않는 시점에 notify_one() 호출
[소비자] wait_for 진입 (최대 2초)
[소비자] 2초 타임아웃 -- 그 notify는 못 받았다

real	0m2.004s
```

(g++ 13.3.0 실측.) 2.004초가 그대로 증거다 — 소비자는 정확히 타임아웃 시간만큼 기다리다가 포기했다. `notify_one()`은 분명 불렸지만, 그 순간 대기 큐가 비어 있었으니 깨울 대상이 없어 아무 일도 하지 않고 끝났다. 이제 조건 자체(`bool ready`)를 뮤텍스로 보호된 상태로 두고 똑같은 순서로 다시 짠다.

```cpp title="cv7_lost_wakeup_fixed.cpp — 조건을 뮤텍스로 보호된 상태로 둔다"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <thread>

std::mutex m;
std::condition_variable cv;
bool ready = false;   // 조건 자체를 뮤텍스로 보호된 상태로 둔다

int main() {
    {
        std::lock_guard<std::mutex> lg(m);
        ready = true;   // 조건을 먼저 세운다 -- 이 시점에도 아직 아무도 안 기다린다
    }
    std::cout << "[메인] 조건을 세우고 notify_one() 호출 (아직 대기자 없음)\n";
    cv.notify_one();   // 역시 이 순간엔 받을 사람이 없다 -- 신호 자체는 똑같이 사라진다

    std::thread consumer([] {
        std::unique_lock<std::mutex> lk(m);
        std::cout << "[소비자] wait 진입\n";
        cv.wait(lk, [] { return ready; });   // 자기 전에 먼저 조건을 검사한다 -- 이미 참이라 자지도 않는다
        std::cout << "[소비자] 통과 -- ready=" << ready << "\n";
    });
    consumer.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra cv7_lost_wakeup_fixed.cpp -o cv7_lost_wakeup_fixed -lpthread
$ time ./cv7_lost_wakeup_fixed
[메인] 조건을 세우고 notify_one() 호출 (아직 대기자 없음)
[소비자] wait 진입
[소비자] 통과 -- ready=1

real	0m0.003s
```

(g++ 13.3.0 실측.) 0.003초 — `cv6`의 2.004초와 정반대다. 신호(`notify_one()`) 자체는 `cv6`와 똑같이 대기자가 없는 시점에 왔고 똑같이 유실됐다. 그런데도 `cv7`은 즉시 통과한다 — 왜냐하면 `wait(lk, pred)`는 **잠들기 전에 먼저 술어를 확인**하고, 그 시점에 이미 `ready`가 참이므로 아예 자지도 않고 곧바로 반환하기 때문이다. 이게 lost wakeup의 정확한 해법이다: "신호를 놓치지 않게 하자"가 아니라 **"신호와 무관하게, 조건 자체를 뮤텍스로 보호된 상태로 두고 wait 진입 시점에 항상 다시 확인한다"**는 것이다. 신호는 놓쳐도 상관없다 — 조건이 이미 참이라면 wait은 그 사실을 신호가 아니라 직접 확인으로 알아낸다.

::: warn notify 신호를 유일한 진실로 삼지 마라
`cv.notify_one()`을 부르는 것과 "조건이 참이 됐다"는 사실은 별개다. `bool`이든 큐의 항목 개수든, 조건 자체를 뮤텍스로 보호된 진짜 상태로 두고 `wait(lk, pred)`로 항상 그 상태를 검사해라. `notify`는 그저 "한 번 확인해 봐도 좋다"는 힌트일 뿐 진실의 원천이 아니다 — 이 원칙 하나가 허위 기상과 lost wakeup을 동시에 해결한다.
:::

## notify_one vs notify_all: 몇 명을 깨우는가

여러 소비자가 같은 조건 변수에서 기다리고 있을 때 `notify_one()`과 `notify_all()`은 완전히 다르게 동작한다. `notify_one()`은 대기 중인 스레드 중 **정확히 하나만**(어떤 스레드인지는 표준이 규정하지 않는다) 깨운다. `notify_all()`은 대기 중인 **전부**를 깨운다 — 깨어난 스레드들은 순서대로 하나씩 락을 다시 잡고 술어를 재확인하는데, 조건을 만족하지 못한 스레드는 다시 잠든다. 소비자 3개, 항목 3개로 두 방식을 직접 비교한다. `wait()`에서 실제로 빠져나온 횟수(술어 재확인 전)를 `total_wakeups`로 센다.

```cpp title="cv8_notify_one.cpp — 항목마다 notify_one()"
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

std::mutex m;
std::condition_variable cv;
std::queue<int> q;
std::atomic<int> waiting_count{0};
std::atomic<int> total_wakeups{0};

void consumer(int id) {
    std::unique_lock<std::mutex> lk(m);
    ++waiting_count;
    while (q.empty()) {
        cv.wait(lk);
        ++total_wakeups;   // wait()에서 빠져나올 때마다 센다
    }
    int v = q.front();
    q.pop();
    std::cout << "  [소비자" << id << "] " << v << " 가져감\n";
}

int main() {
    std::vector<std::thread> cs;
    for (int i = 0; i < 3; ++i) cs.emplace_back(consumer, i);
    while (waiting_count.load() < 3)
        std::this_thread::sleep_for(std::chrono::milliseconds(5));   // 세 소비자 모두 wait 진입까지 대기

    for (int i = 1; i <= 3; ++i) {
        {
            std::lock_guard<std::mutex> lg(m);
            q.push(i * 100);
            std::cout << "[생산자] " << (i * 100) << " 추가, notify_one()\n";
        }
        cv.notify_one();   // 대기 중인 스레드 중 정확히 1개만 깨운다
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
    }

    for (auto& t : cs) t.join();
    std::cout << "notify_one 누적 실제 깨어난 횟수: " << total_wakeups.load() << " (항목 3개)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra cv8_notify_one.cpp -o cv8_notify_one -lpthread
$ ./cv8_notify_one
[생산자] 100 추가, notify_one()
  [소비자0] 100 가져감
[생산자] 200 추가, notify_one()
  [소비자2] 200 가져감
[생산자] 300 추가, notify_one()
  [소비자1] 300 가져감
notify_one 누적 실제 깨어난 횟수: 3 (항목 3개)
```

이제 `cv.notify_one()`을 `cv.notify_all()`로 딱 한 줄만 바꾼 버전이다. 나머지 코드는 전부 동일하다.

```console
$ g++ -std=c++20 -Wall -Wextra cv9_notify_all.cpp -o cv9_notify_all -lpthread
$ ./cv9_notify_all
[생산자] 100 추가, notify_all()
  [소비자0] 100 가져감
[생산자] 200 추가, notify_all()
  [소비자1] 200 가져감
[생산자] 300 추가, notify_all()
  [소비자2] 300 가져감
notify_all 누적 실제 깨어난 횟수: 6 (항목 3개)
```

(g++ 13.3.0 실측, 두 버전 모두 반복 실행 시 어느 소비자가 어느 항목을 가져가는지는 매번 바뀌었지만 깨어난 횟수는 항상 동일했다.) 항목은 똑같이 3개인데 `notify_one`은 깨어남이 **3번**, `notify_all`은 **6번**이다. 이유는 명확하다 — `notify_one`은 매번 대기 중인 스레드 중 하나만 깨우므로 항목 하나당 정확히 하나의 깨어남만 일어난다. `notify_all`은 매번 그 시점에 대기 중인 스레드 **전부**를 깨운다 — 첫 번째 알림에서는 3개 모두 깨어나 그중 1개만 항목을 가져가고 나머지 2개는 큐가 다시 비었으니 술어를 재확인하고 도로 잠든다(이 2번의 "헛깨어남"이 누적 카운트에 들어간다), 두 번째 알림에서는 남은 2개가 깨어나 1개가 성공하고 1개는 다시 잔다, 세 번째 알림에서는 남은 1개가 깨어나 성공한다 — 합이 3+2+1=6이다.

::: tip 언제 notify_one, 언제 notify_all
"이번 조건 변화로 정확히 한 명만 진행할 수 있다"는 게 확실하면(전형적인 생산자-소비자 큐처럼, 항목 하나는 소비자 하나만 가져갈 수 있다) `notify_one`을 써라 — `notify_all`은 이 절에서 실측한 것처럼 나머지를 헛되이 깨웠다 재우는 낭비를 만든다. 반대로 "여러 대기자가 서로 다른 조건으로 자고 있어서 어떤 게 깨어나야 할지 알 수 없거나, 조건 변화로 여러 명이 동시에 진행 가능해지는" 경우(예: 종료 플래그를 세워서 대기 중인 모든 워커를 한꺼번에 내보내야 할 때)는 `notify_all`이 맞다. 확신이 안 서면 `notify_all`을 기본으로 쓰고, 헛깨어남 비용이 실제로 측정될 만큼 크다는 게 확인되면 그때 `notify_one`으로 좁혀도 늦지 않다.
:::

## 로보틱스 도메인: 워커 스레드 풀이 작업 큐를 기다린다

이 절의 생산자-소비자 패턴은 로봇 소프트웨어에서 스레드 풀(thread pool)의 핵심 부품이다 — 여러 워커 스레드가 하나의 작업 큐를 `condition_variable`로 함께 기다리다가, 새 작업이 들어오면 그중 하나(`notify_one`)가 깨어나 처리하고 나머지는 계속 잔다. 카메라 프레임 처리, 경로 재계획 요청, 로그 기록처럼 "일감이 생겼을 때만 처리하면 되고, 일감이 없을 때는 CPU를 전혀 쓰지 말아야 하는" 작업이 정확히 이 절 앞부분의 실측(폴링 89% vs condvar 0%)과 같은 이유로 이 패턴을 쓴다. [6.9 스레드 아키텍처 설계](#/thread-architecture)에서 `hardware_interface`의 스레드 분리 구조를 직접 설계할 때 이 절의 생산자-소비자 뼈대가 그대로 재료가 된다 — 다만 그 절에서 다룰 실시간 제어 루프 스레드 자신은 [6.8 실시간 제약](#/realtime)이 설명하듯 절대 `wait()`로 블록되면 안 된다는 것, 즉 이 패턴은 "실시간이 아닌 워커"에게만 쓴다는 경계선을 그때 분명히 긋는다.

::: interview condition_variable을 다룰 때 자주 나오는 질문 셋
"조건 변수를 어떻게 안전하게 쓰는가"는 동시성 면접의 단골 질문이다. 답변 뼈대: ① `wait()`는 락을 원자적으로 풀고 재웠다가, 깨어날 때 다시 잠근다 — 이 "풀었다 다시 잠그는" 능력이 필요해서 `unique_lock`만 받고 `lock_guard`는 컴파일 타임에 거부된다. ② 허위 기상 — 표준이 `notify` 없이도 `wait()`가 깨어날 수 있다고 허용하므로, `if`로 한 번만 확인하면 안 되고 반드시 `while` 루프나 술어 버전(`wait(lk, pred)`)으로 깨어날 때마다 조건을 다시 검사해야 한다. ③ lost wakeup — `notify`가 `wait`보다 먼저 불리면 그 신호는 사라진다. 해법은 신호를 붙잡으려 하는 게 아니라, 조건 자체(`bool`, 큐 크기 등)를 뮤텍스로 보호된 상태로 두고 `wait` 진입 시점에 그 상태를 직접 확인하는 것이다 — 술어 버전은 자기 전에 먼저 확인하므로 이 문제를 구조적으로 피한다. 이 절의 실측(2.004초 타임아웃 vs 0.003초 즉시 통과)처럼 근거를 실제 수치로 들 수 있으면 답변이 훨씬 구체적으로 들린다.
:::

## 요약

- 뮤텍스만으로 "조건이 될 때까지 기다리기"를 구현하면 폴링이 된다 — 실측 결과 CPU 사용률 89%, 500ms 동안 1,879만 번의 확인이 전부 낭비였다(`cv1`).
- `std::condition_variable::wait()`는 락을 원자적으로 풀고 재웠다가 `notify`를 받으면 다시 락을 잡고 깨어난다 — 같은 시나리오를 CPU 사용률 0%로 처리한다(`cv2`). `wait(lk, pred)`는 `while (!pred()) wait(lk);`의 축약형이다.
- 생산자-소비자 큐는 이 패턴의 실전형이다 — `wait(lk, pred)`로 큐가 비었을 때만 자고, 느린 처리는 락을 잠깐 풀고 하는 게 표준 형태다(실측: `cv3`, TSan 경고 0건).
- `wait()`가 `unique_lock`만 받는 건 대기 도중 락을 풀었다 다시 잠그는 능력이 필요해서다 — `lock_guard`를 넘기면 컴파일 타임에 바로 거부된다(실측: `cv4`, "no matching function" 에러).
- 허위 기상 — `notify` 없이도 `wait()`가 깨어날 수 있다는 걸 표준이 허용한다. `if`로 한 번만 확인하면 아직 조건이 거짓인 채로 진행해 버리는 걸 실제로 재현했고(실측: `cv5a`, 세 번 모두 `ready=0`으로 통과), `while`/술어 버전은 매번 옳은 값만 통과시켰다(실측: `cv5b`).
- lost wakeup — `notify`가 `wait`보다 먼저 오면 그 신호는 사라진다(실측: `cv6`, 2.004초 타임아웃). 해법은 신호가 아니라 조건 자체를 뮤텍스로 보호된 상태로 두고 `wait` 진입 시 직접 확인하는 것이다(실측: `cv7`, 0.003초 즉시 통과 — 신호는 똑같이 유실됐지만 조건이 이미 참이라 문제가 안 됐다).
- `notify_one`은 대기자 중 하나만, `notify_all`은 전부를 깨운다 — 항목 3개를 3명이 나눠 가질 때 `notify_one`은 깨어남 3번, `notify_all`은 6번(나머지가 헛깨었다 다시 자는 비용)이었다(실측: `cv8`/`cv9`).

::: quiz 연습문제
1~2번은 개념·예측 문제, 3번은 설계 판단, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·실행으로 확인하는 실습이다.

1. `cv1_poll_busy.cpp`(폴링)와 `cv2_condvar_wait.cpp`(condition_variable)는 조건이 충족되는 시점(500ms 후)이 완전히 같은데도 CPU 사용률이 89%와 0%로 극단적으로 다르다. 이 차이가 어디서 오는지, `wait()`가 스레드를 커널 수준에서 어떻게 다루는지를 근거로 한 문단으로 설명하라.

2. (예측) 다음 코드를 컴파일하지 말고 무슨 일이 일어날지 예측하고 근거를 써라.

   ```cpp
   std::mutex m;
   std::condition_variable cv;
   int main() {
       std::unique_lock<std::mutex> lk(m);
       cv.wait(lk, [] { return false; });   // 술어가 항상 거짓이다
       return 0;
   }
   ```

3. `notify_all`이 항상 안전한 선택처럼 보이는데(모두 깨워서 알아서 판단하게 하니까), 그런데도 이 절이 "확신이 없으면 `notify_all`을 쓰되 비용이 실제로 측정되면 그때 좁혀라"라고 말하는 이유를 이 절의 6번/3번 실측 배율을 근거로 설명하라.

4. (실습, 코드 작성형) 생산자 하나와 소비자 둘이 하나의 `std::queue<int>`를 공유하는 프로그램을 짜라. 생산자는 항목 10개를 순서대로 넣으면서 매번 `notify_one()`을 부른다. 두 소비자는 각자 `cv.wait(lk, pred)`로 큐가 비었을 때만 자고, 항목을 하나씩 꺼내 자신의 번호와 함께 출력한다. 모든 항목이 정확히 한 번씩만 소비됐는지(두 소비자가 가져간 개수의 합이 정확히 10인지) 직접 로그로 확인하고, `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra`로 TSan 경고가 0건인지 확인하라. 성공 기준: 몇 번을 반복 실행해도 항목 개수 합이 항상 정확히 10이고 TSan이 항상 조용하다.
:::

::: answer 해설
1. `wait()`는 내부적으로 `pthread_cond_wait()`을 호출하고, 이 함수가 뮤텍스를 풀면서 그 스레드를 커널의 futex 대기 큐로 완전히 옮긴다 — 스케줄러는 그 스레드를 실행 후보에서 아예 제외하므로 CPU 타임을 배정하지 않는다. `notify_one()`이 불려야만 커널이 그 스레드를 다시 실행 큐에 올린다. 반대로 폴링 버전은 `lock() → 읽기 → unlock()`을 실제로 계속 실행하는 코드이므로 스케줄러 입장에서는 매 순간 "할 일이 있는 스레드"로 보여 계속 CPU 시간을 받는다 — 그 일이 실질적으로는 아무것도 안 하는 확인 반복이라는 걸 스케줄러는 모른다.
2. 컴파일도 되고 실행도 시작되지만, 술어가 절대 참이 될 수 없으므로 `wait()`는 절대 반환하지 않는다 — 아무도 `ready` 같은 조건을 나중에 바꿔줄 스레드가 없기 때문에 이 프로그램은 영원히 멈춘 채로 끝나지 않는다. 이건 lost wakeup이나 허위 기상과는 다른 문제다 — 조건 자체가 설계상 절대 충족될 수 없는 경우이고, 신호를 아무리 많이 받아도 술어 재확인에서 항상 거짓으로 걸러진다. `Ctrl+C`나 타임아웃 없이는 빠져나올 방법이 없다.
3. `notify_all`의 낭비는 "대기자 수 대비 실제로 진행 가능한 수"의 비율에 비례한다 — 이 절의 실측에서는 대기자 3, 항목 1개씩 순차 도착이라는 최악에 가까운 조건에서 깨어남이 2배(6 vs 3)로 늘었다. 대기자가 적거나(예: 2명), 조건 변화가 정말 여러 명을 동시에 풀어주는 상황(예: 종료 신호)이라면 이 배율은 훨씬 작거나 아예 손해가 아니다 — `notify_all`의 실제 비용은 "이번 이벤트가 몇 명을 깨워도 낭비가 안 되는가"에 달려 있으므로, 그 값을 먼저 재보지 않고 미리 `notify_one`으로 좁히면 특정 대기자만 계속 깨어나지 못하는 실수(조건을 잘못 나눈 경우)를 만들 위험이 오히려 크다. 안전한 기본값에서 시작해 실측으로 좁히는 순서가 맞다.
4. 두 소비자가 각자 `wait(lk, pred)`로 큐가 비었을 때만 자고, 술어가 참이 되는 순간에만 깨어나 하나씩 꺼내 가는 구조라면 항목 10개는 정확히 한 번씩만 어느 한쪽에 돌아가야 한다 — `pop()`과 `front()`가 항상 뮤텍스로 보호된 채로 일어나므로 같은 항목을 두 소비자가 동시에 꺼내는 일은 구조적으로 불가능하다. TSan은 큐 접근이 전부 락 안에서 순서대로 일어나는 걸 확인해 경고를 내지 않아야 한다 — 이 절의 `cv3`/`cv8`/`cv9`가 전부 같은 구조로 TSan을 통과한 것과 같은 이유다.
:::

이 절의 코드는 전부 직접 쳐라. 스레드를 쓰는 예제는 모두 링크 단계에 `-lpthread`가 필요하다. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main -lpthread && ./main`. CPU 사용률을 직접 재려면 `/usr/bin/time -v ./main`(설치 안 돼 있으면 `apt install time`)을 써서 "Percent of CPU this job got" 줄을 확인해라 — `cv1`과 `cv2`를 나란히 돌려서 89%와 0%의 차이를 눈으로 봐라. 허위 기상/lost wakeup 예제(`cv5a`/`cv5b`/`cv6`/`cv7`)는 여러 번 반복 실행해서 결과가 매번 같은 방향으로 재현되는지 직접 확인해라.

**다음 절**: [6.5 atomic과 메모리 오더](#/atomic) — 뮤텍스도, 조건 변수도 없이 `counter++` 하나를 하드웨어 원자적 명령으로 고치는 법을 본다.
