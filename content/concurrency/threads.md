# 6.1 std::thread: 생성, join, 수명

::: lead
Part V까지는 코드가 위에서 아래로, 한 줄씩만 실행된다는 전제가 한 번도 깨지지 않았다. `std::thread` 하나를 만드는 순간 그 전제가 깨진다 — `main()`을 실행하던 스레드와 방금 만든 스레드가 **동시에** 서로 다른 코드를 실행한다. 이 절은 그 스레드 하나의 생애주기만 다룬다: 어떻게 태어나고(생성), 어떻게 정리해야 하고(join/detach), 정리를 잊으면 무슨 일이 나는지(std::terminate), 그리고 C++20이 이 실수를 원천 차단하려고 넣은 `std::jthread`까지. 두 스레드가 같은 데이터를 동시에 건드릴 때 생기는 문제(데이터 레이스)는 다음 절[6.2](#/data-races)로 미룬다 — 이 절에서는 스레드 하나의 존재 자체에 대한 규칙만 본다.
:::

## 스레드를 만들면 진짜로 무슨 일이 일어나는가

`std::thread`는 콜백을 등록해 두고 나중에 불러주는 장치가 아니다. `std::thread` 객체를 만드는 그 줄에서 운영체제에 **새 실행 흐름을 만들어 달라고 요청**하고, 그 실행 흐름은 즉시 원래 스레드와 나란히 돌기 시작한다. 말로만 하지 말고 직접 확인한다 — 함수 하나를 여러 스레드에서 동시에 돌리면서 `std::this_thread::get_id()`로 "지금 이 코드를 실행하는 게 정확히 어떤 스레드인가"를 물어본다.

```cpp title="th1_ids.cpp — 스레드마다 다른 id가 나온다"
#include <iostream>
#include <thread>
#include <vector>
#include <sstream>
#include <mutex>

std::mutex g_print_mtx;  // 출력이 뒤섞이지 않게(6.3 mutex 미리보기) -- 이 절의 주제는 아니다

void print_id(int worker_no) {
    std::ostringstream oss;
    oss << std::this_thread::get_id();
    std::lock_guard<std::mutex> lk(g_print_mtx);
    std::cout << "워커 " << worker_no << " -- 이 스레드의 id = " << oss.str() << "\n";
}

int main() {
    std::ostringstream oss;
    oss << std::this_thread::get_id();
    std::cout << "main()이 실행되는 스레드 id = " << oss.str() << "\n";

    std::vector<std::thread> workers;
    for (int i = 0; i < 4; ++i) {
        workers.emplace_back(print_id, i);
    }
    for (auto& t : workers) t.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th1_ids.cpp -o th1_ids -lpthread
$ ./th1_ids
main()이 실행되는 스레드 id = 140562737448768
워커 0 -- 이 스레드의 id = 140562730579648
워커 1 -- 이 스레드의 id = 140562722186944
워커 2 -- 이 스레드의 id = 140562713794240
워커 3 -- 이 스레드의 id = 140562705401536

$ ./th1_ids
main()이 실행되는 스레드 id = 140632901924672
워커 0 -- 이 스레드의 id = 140632894994112
워커 1 -- 이 스레드의 id = 140632886601408
워커 2 -- 이 스레드의 id = 140632878208704
워커 3 -- 이 스레드의 id = 140632798525120
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 실측, 두 번 실행.) 다섯 개의 id가 전부 다르다 — `main()`을 포함해 이 프로그램은 실제로 **다섯 개의 실행 흐름**을 동시에 갖고 있었다. 실행할 때마다 숫자 자체는 바뀐다(구현이 내부적으로 스레드를 식별하는 값일 뿐, 순번이나 의미 있는 값이 아니다) — 여기서 확인할 것은 절대값이 아니라 "다섯 개가 서로 다르다"는 사실 하나다. `std::vector<std::thread>`에 `emplace_back`으로 스레드를 쌓은 이유는 [5.1 vector](#/vector)에서 본 그대로다 — `std::thread`는 복사할 수 없는 타입이라(뒤에서 볼 소유권 문제 때문이다) 컨테이너에 담으려면 제자리에서 생성하거나 이동해야 한다.

각 스레드는 자기만의 스택을 하나씩 받는다 — [2.1 메모리 모델](#/memory-model)에서 함수 호출이 쌓일 자리로 봤던 그 스택을, 이제 스레드 개수만큼 따로 갖는다는 뜻이다. 이 환경에서 스레드 하나의 기본 스택 크기를 확인하면:

```console
$ ulimit -s
8192
```

(Ubuntu 24.04 실측, 단위는 KB.) 스레드 하나마다 기본 8MB 정도의 스택 공간이 예약된다는 뜻이다 — 스레드를 수천 개씩 띄우면 이 예약분만으로도 가상 주소 공간을 상당히 잡아먹는다. 이 수치는 배포판·`ulimit`설정에 따라 다르므로, 실전에서 스레드 개수를 정할 때는 이 절의 방법 그대로 자신의 환경에서 먼저 확인해라.

## 스레드 생성은 공짜가 아니다 — 실측

함수를 부르는 것과 스레드를 하나 만드는 것은 비용의 자릿수 자체가 다르다. 같은 일(정수 하나 준비하기)을 반복문으로 1만 번 할 때와, 스레드를 1만 개 만들어 각각 시켰다가 전부 `join`할 때를 나란히 잰다.

```cpp title="th2_cost.cpp — 함수 호출 대 스레드 생성+join"
#include <iostream>
#include <thread>
#include <vector>
#include <chrono>

int main() {
    const int N = 10000;

    auto t0 = std::chrono::steady_clock::now();
    long long dummy = 0;
    for (int i = 0; i < N; ++i) {
        dummy += i;   // 순수 함수 호출/연산 비용만 재려고 아주 가벼운 일을 시킨다
    }
    auto t1 = std::chrono::steady_clock::now();

    auto t2 = std::chrono::steady_clock::now();
    std::vector<std::thread> pool;
    pool.reserve(N);
    for (int i = 0; i < N; ++i) {
        pool.emplace_back([i]() { volatile int x = i; (void)x; });
    }
    for (auto& t : pool) t.join();
    auto t3 = std::chrono::steady_clock::now();

    auto ns_call = std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();
    auto us_thread = std::chrono::duration_cast<std::chrono::microseconds>(t3 - t2).count();

    std::cout << "덧셈 " << N << "회 (반복문)      : " << ns_call << " ns\n";
    std::cout << "스레드 생성+join " << N << "회      : " << us_thread << " us\n";
    std::cout << "스레드 1개당 평균 생성+join 비용   : "
              << (double)us_thread / N << " us\n";
    std::cout << "dummy(최적화 방지용) = " << dummy << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -O2 -Wall -Wextra th2_cost.cpp -o th2_cost -lpthread
$ ./th2_cost
덧셈 10000회 (반복문)      : 109 ns
스레드 생성+join 10000회      : 536538 us
스레드 1개당 평균 생성+join 비용   : 53.6538 us
dummy(최적화 방지용) = 49995000
```

::: perf 스레드 하나 = 마이크로초 수십 개, 함수 호출 = 나노초
(g++ 13.3.0 / -O2 / Ubuntu 24.04 x86-64 실측.) 반복문 1만 회는 총 109ns — 곱셈 하나에 채 0.01ns가 안 걸린다. 반면 스레드 1만 개를 만들고 join하는 데는 536,538us(약 0.54초), 스레드 하나당 평균 53.6us다. 같은 컴퓨터에서 같은 코드를 여러 번 돌리면 이 값 자체는 요동친다 — 이 절을 준비하며 여러 번 실행했을 때 스레드 1개당 53us에서 108us 사이를 오갔다(OS 스케줄러가 그때그때 다른 결정을 하기 때문이다, [6.8 실시간 제약](#/realtime)에서 이 변동성 자체를 다시 다룬다). 하지만 절대값이 흔들려도 **자릿수 차이**는 어느 환경에서나 똑같다 — 함수 호출은 나노초 단위, 스레드 생성은 마이크로초 단위. 못해도 수만 배 차이다. 그래서 "반복되는 작은 작업 하나마다 스레드를 새로 만든다"는 설계는 대부분 잘못된 설계다 — 제어 루프처럼 매 주기 반복되는 일에는 스레드를 미리 만들어 두고 재사용하는 쪽(스레드 풀, [6.9 스레드 아키텍처 설계](#/thread-architecture)에서 다룬다)이 맞다.
:::

## join을 잊으면: std::terminate

`std::thread` 객체는 소멸될 때 반드시 둘 중 하나가 이미 불려 있어야 한다 — `join()`(끝날 때까지 기다린다) 아니면 `detach()`(더는 신경 쓰지 않겠다고 선언한다). 둘 다 안 부른 채로 스코프를 벗어나면 어떻게 되는지 직접 재현한다.

```cpp title="th3_noterminate.cpp — join도 detach도 안 부르고 스코프를 나간다"
#include <iostream>
#include <thread>
#include <chrono>

void slow_worker() {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    std::cout << "워커: 작업 끝\n";
}

int main() {
    std::cout.setf(std::ios::unitbuf);   // abort() 전에 버퍼가 반드시 비워지도록
    std::cout << "main 시작\n";
    std::thread t(slow_worker);
    std::cout << "t.joinable() = " << t.joinable() << "\n";
    // join()도 detach()도 안 부르고 t가 스코프를 벗어난다
    std::cout << "main 끝 (join 안 함)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th3_noterminate.cpp -o th3_noterminate -lpthread
$ ./th3_noterminate
main 시작
t.joinable() = 1
main 끝 (join 안 함)
terminate called without an active exception
Aborted (core dumped)
$ echo $?
134
```

(g++ 13.3.0 / Ubuntu 24.04 실측.) `main 끝`까지 정상 출력된 뒤 프로그램이 그 자리에서 죽는다 — `t`가 함수 끝에서 소멸되는 순간, 소멸자가 "나 아직 안 끝났는데(`joinable() == true`) 아무도 나를 정리 안 했다"는 걸 확인하고 `std::terminate()`를 직접 부른다. 예외가 하나도 없었는데도 "terminate called without an active exception"이라고 나오는 게 핵심이다 — 이건 예외 전파 실패가 아니라 **`std::thread` 소멸자가 규칙 위반을 감지하고 의도적으로 프로그램을 끝낸 것**이다. 종료 코드 134는 `SIGABRT`(128+6)를 뜻한다.

::: danger 소멸자가 왜 "그냥 join해 주지" 않는가
`std::thread`가 소멸될 때 자동으로 `join()`을 불러줬다면 이 사고는 안 났을 것 같지만, 표준위원회는 일부러 그렇게 만들지 않았다 — 자동으로 join하면 그 지점에서 **소리 없이 멈춰 기다리는** 코드가 생긴다. 프로그래머가 "여기서 몇 초 동안 멈출 수 있다"는 걸 전혀 모른 채로 스코프를 나가는 모든 곳에서 임의로 블로킹이 생기는 것보다는, 실수를 확실하게 크래시로 알려주는 쪽이 디버깅하기 쉽다는 판단이다. [2.5 RAII](#/raii)의 원칙("소멸자가 자원을 정리한다")이 스레드에는 "정리 방법을 네가 직접 골라라"는 형태로 적용된 셈이다 — `unique_ptr`처럼 기본값 하나로 조용히 해결되지 않는다.
:::

## detach()의 위험: 수명이 스레드보다 짧으면

`detach()`는 "이 스레드가 언제 끝나든 신경 안 쓴다"고 선언하는 것이다. 그 자체는 문법적으로 아무 문제가 없다 — 문제는 detach된 스레드가 **자신을 만든 함수의 지역 변수를 참조로 캡처한 채로** 그 함수보다 오래 살아남으려 할 때 생긴다. 실제로 재현해서 AddressSanitizer로 잡아 본다.

```cpp title="th4_detach_danger.cpp — 함수가 끝난 뒤에도 그 지역 변수를 읽으려는 detach 스레드"
#include <iostream>
#include <thread>
#include <chrono>

// spawn_bad()가 리턴하면 local의 수명은 끝난다.
// 하지만 detach된 스레드는 그 사실을 모르고 100ms 후에도 local을 읽으려 든다.
void spawn_bad() {
    int local = 42;
    std::thread t([&local]() {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        std::cout << "detach된 스레드가 읽은 값: " << local << "\n";  // 이미 죽은 스택 프레임을 읽는다
    });
    t.detach();
}

int main() {
    spawn_bad();
    // 이 sleep이 없으면 main이 먼저 끝나 프로세스 자체가 종료되며 detach된 스레드도 그냥 죽는다.
    // 실전에서는 이 sleep이 없다 -- 그래서 이 버그는 "운 좋으면" 안 터진다.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::cout << "main 끝\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g th4_detach_danger.cpp -o th4_detach_danger -lpthread
$ ./th4_detach_danger
==26301==ERROR: AddressSanitizer: stack-use-after-return on address 0x7f81a4c000b0 at pc 0x5631548595e3 bp 0x7f81a39febf0 sp 0x7f81a39febe0
READ of size 4 at 0x7f81a4c000b0 thread T1
    #0 0x5631548595e2 in operator() th4_detach_danger.cpp:11
    #1 0x563154859ecb in __invoke_impl<void, spawn_bad()::<lambda()> > /usr/include/c++/13/bits/invoke.h:61
    ...
Address 0x7f81a4c000b0 is located in stack of thread T0 at offset 48 in frame
    #0 0x563154859680 in spawn_bad() th4_detach_danger.cpp:7

  This frame has 3 object(s):
    [48, 52) 'local' (line 8) <== Memory access at offset 48 is inside this variable
    [64, 72) 't' (line 9)
    [96, 104) '<unknown>'
SUMMARY: AddressSanitizer: stack-use-after-return th4_detach_danger.cpp:11 in operator()
==26301==ABORTING
```

(g++ 13.3.0 / Ubuntu 24.04 실측, 스택 트레이스는 지면상 일부 생략. 전체 출력은 직접 실행해서 확인해라.) ASan이 정확히 짚어낸다 — `local`은 `spawn_bad()`의 스택 프레임(스레드 T0)에 있었는데, 그 프레임이 이미 반환된 뒤에 다른 스레드(T1)가 같은 주소를 읽으려 했다는 것("stack-use-after-return"). `spawn_bad()`가 리턴하는 순간 `local`의 수명은 [2.1 메모리 모델](#/memory-model)의 규칙대로 끝났고, 그 스택 공간은 다른 용도로 재사용될 수 있는 상태가 됐다. detach된 람다가 100ms 뒤에 그 자리를 읽었을 때 마침 값이 덮어써지지 않았다면(스택이 당장 재사용되지 않았다면) 우연히 `42`가 찍혔을 수도 있다 — 새니타이저 없이 돌렸다면 이 사고는 조용히 넘어갔을 것이고, 그게 더 무섭다.

::: warn detach는 "신경 안 쓴다"이지 "안전하다"가 아니다
`detach()`를 부르는 순간 그 스레드가 참조하는 모든 것(지역 변수, `this`, 캡처한 레퍼런스)이 자신을 만든 함수보다 오래 살아남는지 스스로 보장해야 한다. 안전하게 detach하려면 참조 대신 **값을 복사해서 캡처**하거나(`[local]`처럼), 대상이 프로그램 전체 수명 동안 살아있는 객체(전역, `shared_ptr`로 관리되는 힙 객체)를 가리켜야 한다. 확신이 없으면 detach하지 말고 join해라 — [6.9 스레드 아키텍처 설계](#/thread-architecture)에서 볼 실전 패턴은 대부분 detach가 아니라 명시적으로 join하거나 `jthread`를 쓴다.
:::

## std::jthread(C++20): 자동 join과 협조적 취소

`std::thread`의 "정리를 잊으면 죽는다"는 규칙 자체를 없애 버린 타입이 C++20의 `std::jthread`다. 소멸자가 자동으로 `join()`을 불러주고, 여기에 더해 `std::stop_token`으로 "이제 그만 멈춰라"는 신호를 스레드 안에서 직접 확인할 수 있다.

```cpp title="th5_jthread.cpp — request_stop()으로 무한 루프를 협조적으로 세운다"
#include <iostream>
#include <thread>
#include <chrono>
#include <atomic>

int main() {
    std::atomic<int> loop_count{0};

    std::jthread worker([&loop_count](std::stop_token st) {
        while (!st.stop_requested()) {
            ++loop_count;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        std::cout << "워커: stop_requested() == true, 루프 탈출\n";
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(105));
    worker.request_stop();
    std::cout << "main: request_stop() 호출 -- worker의 소멸자가 자동으로 join한다\n";
    // worker(jthread)가 여기서 스코프를 벗어나며 소멸자가 join()을 대신 호출한다.
    // std::thread였다면 이 join을 잊었을 때 th3_noterminate.cpp와 같은 std::terminate가 났다.

    std::cout << "루프 반복 횟수(대략): " << loop_count.load() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th5_jthread.cpp -o th5_jthread -lpthread
$ ./th5_jthread
main: request_stop() 호출 -- worker의 소멸자가 자동으로 join한다
루프 반복 횟수(대략): 11
워커: stop_requested() == true, 루프 탈출
```

(g++ 13.3.0 실측.) 출력 순서를 눈여겨봐라 — "워커: ... 루프 탈출"이 **가장 마지막**에 찍힌다. `main()`이 `return 0`에 도달한 뒤 지역 변수들이 역순으로 소멸하는데, `worker`(jthread)의 소멸자가 그 자리에서 내부적으로 `join()`을 불러 워커 스레드가 실제로 루프를 빠져나올 때까지 **블록**하기 때문이다 — 그래서 "루프 반복 횟수" 출력 다음에도 프로그램은 곧바로 끝나지 않고, 워커의 마지막 메시지가 찍힌 뒤에야 종료된다. `std::thread`를 썼다면 이 자동 join이 없었을 테니, `worker`가 스코프를 나가는 순간 `th3_noterminate.cpp`와 똑같이 `std::terminate`가 났을 것이다.

::: tip jthread를 기본값으로 삼아라
새로 스레드를 만들 자리에서 `join()`을 직접 관리해야 할 특별한 이유가 없다면 `std::thread` 대신 `std::jthread`를 써라. C++20을 쓸 수 있는 환경(이 책의 실습 환경 포함)이라면 이 기본값 하나만으로 "join 잊음 → terminate" 사고 자체가 사라진다. `stop_token`은 덤이 아니라 실전에서 자주 필요한 기능이다 — 센서 폴링 스레드를 프로그램 종료 시 깔끔하게 세우는 표준적인 방법이 이거다.
:::

## 인자를 스레드에 넘기는 법

`std::thread`(또는 `jthread`) 생성자는 호출 가능한 것 하나와 그 뒤에 인자들을 받는다 — `std::thread(함수, 인자1, 인자2, ...)`. 문제는 **이 인자들이 기본적으로 전부 값으로 복사되어 새 스레드로 넘어간다**는 것이다. 값으로 넘기면 그대로 동작한다.

```cpp title="th9_byvalue.cpp — 값 전달은 복사본이라 원본을 못 바꾼다"
#include <iostream>
#include <thread>

void add_one_by_value(int x) { ++x; }   // x는 호출자의 counter와 무관한 사본이다

int main() {
    int counter = 0;
    std::thread t(add_one_by_value, counter);   // counter가 그대로 복사되어 스레드로 넘어간다
    t.join();
    std::cout << "counter = " << counter << " (스레드 안에서 증가시켰다고 착각하기 쉽다)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th9_byvalue.cpp -o th9_byvalue -lpthread
$ ./th9_byvalue
counter = 0 (스레드 안에서 증가시켰다고 착각하기 쉽다)
```

(g++ 13.3.0 실측 — 경고 없음.) 함수는 `int&`가 아니라 `int`를 받으니 당연한 결과다. 문제는 함수 시그니처가 진짜로 레퍼런스를 요구할 때 일어난다 — `std::thread`는 넘겨받은 인자를 내부적으로 **decay 후 저장**했다가 스레드 함수에 rvalue로 넘긴다([1.7 배열과 문자열](#/arrays-strings)에서 본 decay와 이름은 같지만 여기서는 값 범주 얘기다). 레퍼런스 매개변수에 그냥 변수를 넘기면 컴파일이 아예 안 된다.

```cpp title="th6_args_ref_broken.cpp — std::ref 없이 레퍼런스 매개변수에 넘긴다"
#include <iostream>
#include <thread>

void add_one(int& x) { ++x; }

int main() {
    int counter = 0;
    std::thread t(add_one, counter);   // std::ref 없이 레퍼런스 매개변수에 넘긴다
    t.join();
    std::cout << counter << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th6_args_ref_broken.cpp -o th6_args_ref_broken -lpthread
th6_args_ref_broken.cpp: In instantiation of 'std::thread::thread(_Callable&&, _Args&& ...) [with _Callable = void (&)(int&); _Args = {int&}]':
th6_args_ref_broken.cpp:8:35:   required from here
/usr/include/c++/13/bits/std_thread.h:157:72: error: static assertion failed: std::thread arguments must be invocable after conversion to rvalues
/usr/include/c++/13/bits/std_thread.h:291:11: error: no type named 'type' in 'struct std::thread::_Invoker<...>::__result<...>'
```

(g++ 13.3.0 실측, 메시지 일부 생략.) "std::thread arguments must be invocable after conversion to rvalues"라는 문장이 정확히 이 절의 요점이다 — 인자를 rvalue로 바꾼 다음(=복사본을 만든 다음) 그 복사본으로 함수를 부를 수 있어야 하는데, `int&`는 rvalue를 받을 수 없으니 실패한다. 해결책은 `std::ref`로 "이건 진짜로 레퍼런스로 넘겨라"라고 명시하는 것이다.

```cpp title="th7_args_ref_fixed.cpp — std::ref로 감싸면 진짜 레퍼런스가 전달된다"
#include <iostream>
#include <thread>
#include <functional>

void add_one(int& x) { ++x; }

int main() {
    int counter = 0;
    std::thread t(add_one, std::ref(counter));   // std::ref로 감싸야 진짜 레퍼런스로 전달된다
    t.join();
    std::cout << "counter = " << counter << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th7_args_ref_fixed.cpp -o th7_args_ref_fixed -lpthread
$ ./th7_args_ref_fixed
counter = 1
```

(g++ 13.3.0 실측.) `std::ref(counter)`는 `std::reference_wrapper<int>`를 만든다 — 이 래퍼는 복사해도 안전하고(복사되는 건 래퍼 자체지 원본 `int`가 아니다), 함수가 필요로 하는 `int&`로 암묵 변환된다. 그래서 "decay 후 복사"라는 `std::thread`의 규칙을 어기지 않으면서도 결과적으로 원본을 가리키게 된다.

멤버 함수를 스레드로 돌리는 문법도 같은 규칙(호출 가능한 것 + 인자들) 위에 있다 — 멤버 함수 포인터와 그 함수를 부를 객체의 주소를 앞의 두 인자로 준다.

```cpp title="th8_member.cpp — 멤버 함수를 스레드로 돌린다"
#include <iostream>
#include <thread>
#include <string>

class SensorPoller {
public:
    explicit SensorPoller(std::string name) : name_(std::move(name)) {}

    void poll(int times) {
        for (int i = 0; i < times; ++i) {
            ++reading_count_;
        }
        std::cout << name_ << ": " << reading_count_ << "회 읽음\n";
    }

private:
    std::string name_;
    int reading_count_ = 0;
};

int main() {
    SensorPoller imu("IMU");
    // 멤버 함수 포인터 + 객체 주소를 첫 두 인자로 준다: &Class::method, &instance, 나머지 인자...
    std::thread t(&SensorPoller::poll, &imu, 1000);
    t.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th8_member.cpp -o th8_member -lpthread
$ ./th8_member
IMU: 1000회 읽음
```

(g++ 13.3.0 실측.) `&imu`를 넘겼다는 건 스레드가 `imu` 객체를 참조로 다룬다는 뜻이다 — `th4_detach_danger.cpp`에서 본 수명 문제가 여기도 그대로 적용된다. `imu`가 `t.join()`보다 먼저 스코프를 벗어나면 안 된다.

::: warn std::ref를 빼먹는 흔한 실수
"레퍼런스 매개변수인데 컴파일이 왜 안 되지"는 `std::thread`를 처음 쓸 때 거의 누구나 만나는 에러다. 함수 시그니처가 `T&`를 받는데 스레드 생성자에 변수를 그냥 넘겼다면 `th6_args_ref_broken.cpp`의 에러 메시지("must be invocable after conversion to rvalues")를 다시 떠올려라 — `std::ref`를 빼먹었다는 신호다.
:::

## 몇 개까지 동시에 돌릴 수 있는가: hardware_concurrency()

스레드는 개수 제한 없이 만들 수 있지만(운영체제 자원이 허락하는 한), 실제로 **동시에** 실행되는 개수는 CPU 코어 수만큼이 한계다. `std::thread::hardware_concurrency()`는 이 환경이 대략 몇 개의 실행 흐름을 물리적으로 동시에 굴릴 수 있는지 알려준다.

```cpp title="th10_hwc.cpp — 이 환경의 하드웨어 동시성 힌트"
#include <iostream>
#include <thread>

int main() {
    std::cout << "std::thread::hardware_concurrency() = "
              << std::thread::hardware_concurrency() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra th10_hwc.cpp -o th10_hwc -lpthread
$ ./th10_hwc
std::thread::hardware_concurrency() = 4
```

(g++ 13.3.0 / Ubuntu 24.04 실측 — 이 값은 실행 중인 기기의 코어/스레드 수에 따라 다르다. 이 환경은 4를 돌려줬다.) 표준은 이 값이 "힌트"일 뿐이라고 못박는다 — 정보를 못 구하면 `0`을 돌려줄 수도 있다. 그래서 이 값을 나눗셈 등에 그대로 쓰기 전에는 `0`인 경우를 방어해야 한다(`std::max(1u, hardware_concurrency())`처럼). 스레드 풀 크기를 정할 때 이 값을 기준으로 삼는 게 보통이다 — 코어 수보다 훨씬 많은 스레드를 동시에 돌려봤자 스케줄러가 번갈아 끼워 넣을 뿐이고, `th2_cost.cpp`에서 본 생성 비용만 계속 쌓인다.

## 로보틱스 연결: 왜 센서 폴링과 제어 루프를 스레드로 분리하는가

헥사포드 같은 로봇에서는 최소 두 가지 일이 서로 다른 주기로 반복된다 — IMU·라이다 같은 센서를 읽는 일과, 그 값을 바탕으로 관절 명령을 계산해 내보내는 제어 루프다. 둘을 한 스레드에서 순서대로 처리하면, 센서 읽기가 예상보다 오래 걸리는 순간(드라이버 지연, 통신 타임아웃) 제어 루프 주기 전체가 밀린다 — 실시간 제어에서는 이 지연(지터)이 곧 불안정한 동작으로 이어진다. 이 절에서 본 `std::jthread` + `stop_token` 조합이 정확히 이 분리의 기초 도구다 — 센서 폴링을 별도 스레드로 띄우고, 프로그램 종료 시 `request_stop()`으로 깔끔하게 세운다. 이 분리를 실제로 어떻게 설계하는지는 [6.9 스레드 아키텍처 설계](#/thread-architecture)에서 처음부터 다루고, `ros2_control`의 `hardware_interface`가 정확히 이 구조 위에 서 있다는 것은 [10.9 ros2_control과 hardware_interface](#/ros2-control)에서 다시 만난다.

::: interview join과 detach, 언제 어느 쪽을 쓰는가
"`std::thread`에서 join과 detach의 차이, 그리고 언제 무엇을 쓰는가"는 동시성 기초를 확인하는 전형적인 질문이다. 답변 뼈대: ① `join()`은 호출한 스레드가 대상 스레드의 종료를 **기다린다** — 결과를 합류시켜야 하거나, 대상이 참조하는 지역 자원의 수명을 스레드 종료 시점과 맞춰야 할 때 쓴다. ② `detach()`는 "이후로는 신경 쓰지 않겠다"는 선언이다 — 백그라운드에서 독립적으로 끝나도 되는 작업(수명이 프로그램 전체와 같거나, 캡처한 게 전부 값 복사인 경우)에만 안전하다. ③ 실전에서는 `detach()`보다 `join()`(또는 `jthread`의 자동 join)을 압도적으로 더 많이 쓴다 — detach된 스레드는 프로그램이 그 스레드가 참조하는 것들의 수명을 계속 보장해야 하는데, 이 보장이 깨지면 `th4_detach_danger.cpp`처럼 새니타이저가 있어야만 겨우 잡히는 수명 버그가 된다. ④ `std::thread`를 쓰다가 join/detach를 잊으면 `std::terminate`가 난다는 것도 같이 짚으면(`th3_noterminate.cpp`) 이 질문을 한 단계 더 깊이 답한 것이 된다.
:::

## 요약

- `std::thread`를 만들면 실제로 새 OS 스레드가 생긴다 — `std::this_thread::get_id()`로 서로 다른 실행 흐름임을 확인했다(실측: `th1_ids.cpp`, id 다섯 개가 전부 다름). 스레드마다 별도 스택을 받는다(이 환경 기본 8MB, `ulimit -s` 실측).
- 스레드 생성은 함수 호출과 자릿수가 다른 비용이다 — 이 환경에서 스레드 1개당 평균 생성+join 비용은 수십 마이크로초, 함수 호출은 나노초 단위였다(실측: `th2_cost.cpp`). 반복되는 짧은 작업마다 스레드를 새로 만들지 마라.
- `std::thread` 객체가 `joinable()` 상태로 소멸되면 `std::terminate`가 호출돼 프로그램이 죽는다(실측: `th3_noterminate.cpp`, 종료 코드 134/SIGABRT) — 소멸자는 자동으로 join해 주지 않는다.
- `detach()`된 스레드가 자신을 만든 함수의 지역 변수를 참조로 캡처한 채 그 함수보다 오래 살면 stack-use-after-return이 난다(실측: `th4_detach_danger.cpp`, AddressSanitizer가 정확히 잡아냄).
- C++20 `std::jthread`는 소멸자에서 자동으로 join하고(실측: `th5_jthread.cpp`, 마지막 메시지가 소멸자의 join 완료 후에 찍힘), `std::stop_token`으로 무한 루프를 협조적으로 세울 수 있다.
- 스레드 생성자는 인자를 기본적으로 복사한다 — 레퍼런스로 넘기려면 `std::ref`가 필요하고(실측: `th6_args_ref_broken.cpp`의 컴파일 에러, `th7_args_ref_fixed.cpp`의 정상 동작), 멤버 함수는 `&Class::method, &instance, 인자...` 형태로 돌린다(실측: `th8_member.cpp`).
- `std::thread::hardware_concurrency()`는 이 기기가 동시에 실행할 수 있는 실행 흐름 수의 힌트다(이 환경 실측: `4`) — 스레드 풀 크기를 정할 때 기준으로 쓴다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 설계 판단, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·실행으로 확인하는 실습이다.

1. `th3_noterminate.cpp`와 `th5_jthread.cpp`를 근거로, `std::thread`와 `std::jthread`가 "정리를 잊은 경우"에 각각 어떻게 다르게 반응하는지 한 문단으로 설명하라.

2. (예측) 다음 코드를 컴파일하지 말고 무슨 일이 일어날지 예측하고 근거를 써라.

   ```cpp
   void set_flag(bool& flag) { flag = true; }

   int main() {
       bool done = false;
       std::thread t(set_flag, done);   // std::ref 없음
       t.join();
   }
   ```

3. 센서 폴링 스레드를 설계한다고 하자. 이 스레드를 `detach()`하는 설계와 `jthread` + `stop_token`으로 관리하는 설계를 비교하라. 각각 어떤 상황에서 실제 문제가 되는지 하나씩 들어라(힌트: 프로그램 종료 시점, 스레드가 참조하는 객체의 수명).

4. (실습, 코드 작성형) `std::jthread`로 1초에 여러 번 반복되는 워커를 만들어라 — 매 반복마다 `std::atomic<int>` 카운터를 증가시키고, `main`은 300ms 뒤 `request_stop()`을 부른 다음 최종 카운터 값을 출력한다. 그다음 같은 로직을 일부러 `std::thread`(자동 join 없음)로 바꿔 짜고, `join()`을 빼먹은 채로 컴파일·실행해서 `std::terminate`가 나는 것을 직접 확인하라. 성공 기준: `jthread` 버전은 깨끗하게 종료되고, `thread` 버전(join 없음)은 네 터미널에서 종료 코드 134로 죽는 것을 직접 봤다.
:::

::: answer 해설
1. `th3_noterminate.cpp`의 `std::thread`는 `joinable()`(아직 join도 detach도 안 된 상태)인 채로 소멸자가 불리면 그 자리에서 `std::terminate()`를 호출해 프로그램 전체를 죽인다 — 이 절에서 실측한 대로 "terminate called without an active exception"이 찍히고 SIGABRT로 종료된다. `th5_jthread.cpp`의 `std::jthread`는 같은 상황(소멸 시점에 아직 실행 중)에서 소멸자가 알아서 `request_stop()`과 `join()`을 순서대로 불러 스레드가 실제로 끝날 때까지 기다린 뒤 정상적으로 넘어간다 — 실측에서 본 것처럼 워커의 마지막 메시지가 소멸자 안에서 찍히고 나서야 프로그램이 끝난다. 즉 `thread`는 "규칙 위반을 크래시로 알린다", `jthread`는 "애초에 규칙을 어길 수 없게 만든다"는 차이다.
2. 컴파일되지 않는다. `set_flag`가 `bool&`를 받는데 `std::thread` 생성자는 인자를 decay 후 복사해서 저장했다가 rvalue로 넘기려 하고, `bool&`는 rvalue를 받을 수 없다 — `th6_args_ref_broken.cpp`와 정확히 같은 패턴이라 "std::thread arguments must be invocable after conversion to rvalues"라는 정적 단언 실패가 난다. 고치려면 `std::thread t(set_flag, std::ref(done));`으로 바꿔야 한다.
3. `detach()` 설계가 실제 문제가 되는 지점: 프로그램(또는 그 스레드를 포함하는 노드)이 종료되는 순간, detach된 스레드가 여전히 센서 드라이버 객체나 콜백이 캡처한 지역 자원을 참조하고 있다면 그 객체가 먼저 소멸된 뒤에도 스레드가 계속 접근을 시도할 수 있다 — `th4_detach_danger.cpp`와 같은 부류의 수명 버그이고, 발생 시점이 프로그램 종료 타이밍에 따라 달라서 재현하기 어렵다. `jthread` + `stop_token` 설계가 실제 문제가 되는 지점: 스레드 함수가 `stop_token`을 무시하고 블로킹 호출(응답 없는 네트워크 read 등)에 갇혀 있으면 `request_stop()`을 불러도 그 호출에서 못 빠져나와 소멸자의 `join()`이 계속 대기한다 — 취소 신호를 스레드 내부 루프가 실제로 자주 확인하도록 짜야만 `stop_token`의 장점이 산다.
4. `jthread` 버전은 스코프를 벗어나면 소멸자가 `request_stop()` 호출 여부와 무관하게 알아서 join하므로 항상 깨끗하게 끝난다(이미 `request_stop()`을 부른 뒤라면 그 즉시, 안 불렀어도 소멸자가 마무리한다). `thread` 버전에서 `join()`을 빼먹으면 `th3_noterminate.cpp`와 똑같이 `terminate called without an active exception`이 찍히고 `echo $?`로 확인한 종료 코드가 134가 나와야 한다 — 안 나온다면 어딘가에서 `join()`이 실제로는 불리고 있다는 뜻이니 코드를 다시 봐야 한다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `th3_noterminate.cpp`와 `th4_detach_danger.cpp`는 "왜 위험한가"를 글로만 읽는 것과, 네 터미널에서 실제로 프로그램이 죽는 걸 보는 것 사이에 체감 차이가 크다. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main -lpthread && ./main`. `th4_detach_danger.cpp`는 반드시 `-fsanitize=address -g`를 추가해서 돌려라 — 새니타이저 없이 돌리면 이 버그는 대부분 조용히 넘어간다는 것 자체가 이 절의 요점이다: `g++ -std=c++20 -Wall -Wextra -fsanitize=address -g main.cpp -o main -lpthread && ./main`.

**다음 절**: [6.2 데이터 레이스의 해부](#/data-races) — 스레드 하나의 생애주기는 여기서 끝난다. 다음 절부터는 두 스레드가 같은 변수를 동시에 건드릴 때 `counter++`가 왜 원자적이지 않은지, 그 인터리빙을 위젯으로 직접 재생하며 본다.
