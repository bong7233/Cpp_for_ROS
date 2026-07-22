# 6.7 async, future, promise

::: lead
[6.1](#/threads)에서 스레드 하나를 만들고 join하는 법을 배웠다. 그런데 "결과값 하나를 비동기로 계산해서 나중에 받는다"는 목적 하나를 위해서도 그 방법은 손이 많이 간다 — 결과를 어디에 저장할지 변수를 따로 준비해야 하고, 그 변수를 두 스레드가 동시에 건드리지 않게 뮤텍스로 지켜야 하고, 계산 도중 예외가 나면 그 예외를 손으로 붙잡아뒀다가 나중에 다시 던져야 한다. 이 절은 이 세 가지를 전부 대신 해주는 `std::async`/`std::future`/`std::promise`를 다룬다 — 스레드라는 실행 단위 대신 "태스크 하나, 결과 하나"라는 단위로 병렬성을 표현하는 방법이다.
:::

## 스레드로 결과값 하나만 받으려면 이렇게까지 해야 한다

함수 하나를 다른 스레드에서 실행하고 그 반환값을 받아오고 싶을 뿐이다. `std::thread`로 이걸 하려면 반환값을 담을 자리, 그 자리를 보호할 잠금, 예외가 났을 때를 위한 별도 저장소까지 전부 손으로 준비해야 한다.

```cpp title="af0_manual.cpp — std::thread만으로 결과값 하나와 예외를 받아온다"
#include <iostream>
#include <thread>
#include <exception>
#include <mutex>

struct Result {
    int value = 0;
    std::exception_ptr err;   // 예외를 저장해 둘 자리를 직접 마련해야 한다
    bool ready = false;
};

int risky_compute(int x) {
    if (x < 0) throw std::runtime_error("음수는 계산할 수 없다");
    return x * x;
}

int main() {
    Result r;
    std::mutex m;

    std::thread t([&] {
        try {
            int v = risky_compute(-5);
            std::lock_guard<std::mutex> lk(m);
            r.value = v;
        } catch (...) {
            std::lock_guard<std::mutex> lk(m);
            r.err = std::current_exception();  // 예외를 손으로 붙잡아 저장해야 한다
        }
        std::lock_guard<std::mutex> lk(m);
        r.ready = true;
    });
    t.join();

    if (r.err) {
        try {
            std::rethrow_exception(r.err);  // 저장해뒀던 예외를 다시 던진다
        } catch (const std::exception& e) {
            std::cout << "메인 스레드에서 잡은 예외: " << e.what() << "\n";
        }
    } else {
        std::cout << "결과: " << r.value << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af0_manual.cpp -o af0_manual -lpthread
$ ./af0_manual
메인 스레드에서 잡은 예외: 음수는 계산할 수 없다
```

(g++ 13.3.0 / Ubuntu 24.04 실측.) 결과는 정확하다 — 하지만 이 코드를 짜기 위해 `Result` 구조체, `std::mutex`, `exception_ptr`, `current_exception()`/`rethrow_exception()`까지 네 가지 도구를 동원했다. 함수 하나 부르고 값 하나 받는 일치고는 장비가 과하다. `std::async`는 정확히 이 네 가지를 표준 라이브러리 안에 미리 구현해 둔 것이다.

## std::async와 std::future: 태스크를 맡기고 결과를 나중에 받는다

`std::async`는 함수(와 인자들)를 받아서 어딘가에서 실행되도록 예약하고, 그 결과를 나중에 받을 수 있는 손잡이인 `std::future`를 즉시 돌려준다. `future::get()`을 부르는 순간 결과가 준비돼 있으면 바로 값을 받고, 아직이면 준비될 때까지 그 자리에서 블록한다.

```cpp title="af1_basic.cpp — async로 맡기고 future로 받는다"
#include <future>
#include <iostream>

int risky_compute(int x) {
    return x * x;
}

int main() {
    std::future<int> fut = std::async(std::launch::async, risky_compute, 7);
    std::cout << "async 호출 직후, get() 부르기 전 -- 계속 다른 일을 할 수 있다\n";
    int result = fut.get();   // 결과가 없으면 여기서 블록한다
    std::cout << "결과: " << result << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af1_basic.cpp -o af1_basic -lpthread
$ ./af1_basic
async 호출 직후, get() 부르기 전 -- 계속 다른 일을 할 수 있다
결과: 49
```

(g++ 13.3.0 실측.) `af0_manual.cpp`가 `Result` 구조체와 `mutex`로 손수 만들었던 것 — "결과를 어딘가에 안전하게 저장했다가 나중에 꺼내는 자리" — 를 `std::future<int>` 하나가 대신한다. `af0_manual.cpp`의 `Result`처럼, `future`와 `promise`(뒤에서 본다)가 내부적으로 공유하는 이 저장소를 표준은 **공유 상태(shared state)**라고 부른다 — `async`를 부르면 이 공유 상태가 만들어지고, 함수의 반환값(또는 예외)이 여기 채워지고, `future::get()`이 여기서 값을 꺼낸다.

::: danger async가 돌려준 future를 변수에 안 받으면 그 자리에서 블록한다
`std::async`의 반환값을 무시하면 무슨 일이 나는지 직접 확인한다.

```cpp title="af9_discard.cpp — future를 받지 않고 버린다"
#include <future>
#include <chrono>
#include <thread>
#include <iostream>

int main() {
    std::cout << "A\n";
    std::async(std::launch::async, [] {
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        std::cout << "  (백그라운드 작업 끝)\n";
    });   // 반환된 future를 변수에 받지 않았다 -- 이 임시 객체는 이 문장이 끝나는 즉시 소멸된다
    std::cout << "B (A 직후 곧바로 찍힐 거라 예상하기 쉽다)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af9_discard.cpp -o af9_discard -lpthread
af9_discard.cpp:11:7: warning: ignoring return value of 'std::async(...)' ... declared with attribute 'nodiscard' [-Wunused-result]
$ ./af9_discard
A
  (백그라운드 작업 끝)
B (A 직후 곧바로 찍힐 거라 예상하기 쉽다)
```

(g++ 13.3.0 / `-Wall -Wextra` 실측, 경고 메시지 일부 생략.) "B"는 "A" 직후 곧바로 찍히지 않는다 — `std::this_thread::sleep_for`가 끝나고 "(백그라운드 작업 끝)"이 찍힌 **다음에야** "B"가 나온다. `std::async(std::launch::async, ...)`가 돌려준 임시 `future`는 그 표현식이 끝나는 문장의 끝에서 곧바로 소멸되는데, 이 소멸자가 내부적으로 `get()`과 똑같이 **작업이 끝날 때까지 블록**하기 때문이다 — 다른 모든 `future`의 소멸자는 블록하지 않는다는 것과 정반대라 함정이다. `-Wall`이 `[[nodiscard]]` 경고로 이 실수를 미리 잡아준다는 것도 함께 기억해라 — 이 경고를 무시하지 마라.
:::

## launch::async vs launch::deferred: 실측으로 구분한다

`std::async`의 첫 인자는 실행 정책(launch policy)이다. `std::launch::async`는 "반드시 별도 스레드에서, 지금 바로" 실행하라는 뜻이고, `std::launch::deferred`는 "지금은 아무것도 하지 말고, `get()`을 부르는 바로 그 시점에 그 호출자 스레드 위에서" 실행하라는 뜻이다. 말로만 하지 말고 두 경우 모두 어느 스레드에서 도는지 `std::this_thread::get_id()`로 확인한다.

```cpp title="af2_launch_policy.cpp — async와 deferred가 실행되는 스레드를 실측으로 구분한다"
#include <future>
#include <iostream>
#include <sstream>
#include <thread>

std::string tid() {
    std::ostringstream oss;
    oss << std::this_thread::get_id();
    return oss.str();
}

int report(const char* label) {
    std::cout << label << " 실행 스레드 id = " << tid() << "\n";
    return 0;
}

int main() {
    std::cout << "main() 스레드 id       = " << tid() << "\n";

    auto fut_async = std::async(std::launch::async, report, "launch::async  ");
    fut_async.get();   // 이 시점엔 이미 별도 스레드에서 실행이 끝나 있었다

    auto fut_deferred = std::async(std::launch::deferred, report, "launch::deferred");
    std::cout << "-- get() 부르기 전까지 deferred 함수는 아직 실행 안 됨 --\n";
    fut_deferred.get();   // 바로 이 줄에서, 이 호출 스레드 위에서 지금 실행된다

    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af2_launch_policy.cpp -o af2_launch_policy -lpthread
$ ./af2_launch_policy
main() 스레드 id       = 140424051193664
launch::async   실행 스레드 id = 140424043820736
-- get() 부르기 전까지 deferred 함수는 아직 실행 안 됨 --
launch::deferred 실행 스레드 id = 140424051193664
```

(g++ 13.3.0 / Ubuntu 24.04 실측. 절대값인 id 자체는 실행마다 바뀐다 — 확인할 것은 서로 같은지 다른지다.) `launch::async`로 실행한 함수의 id는 `main()`의 id와 **다르다** — 진짜로 별도 스레드가 만들어져 그 위에서 돌았다. `launch::deferred`로 실행한 함수의 id는 `main()`의 id와 **정확히 같다** — 새 스레드는 아예 만들어지지 않았고, `get()`을 부른 그 자리에서 `main()` 스레드가 직접 함수를 실행했다. `deferred`는 사실 지연 평가(lazy evaluation)에 가깝다 — `get()`을 한 번도 안 부르면 함수는 영원히 실행되지 않는다.

::: warn 정책을 생략하면 컴파일러가 골라도 된다
`std::async(risky_compute, 7)`처럼 정책 없이 부르면 `std::launch::async | std::launch::deferred`가 기본값이다 — 구현이 `async`와 `deferred` 중 무엇을 고를지는 표준이 정해주지 않는다(스레드 풀이 이미 꽉 찼으면 `deferred`로 미룰 수도 있다). "항상 별도 스레드에서 지금 당장 돈다"는 걸 보장받고 싶으면 **반드시 `std::launch::async`를 명시해라** — 이 절의 예제가 전부 그렇게 하는 이유다.
:::

## 예외는 get()에서 호출자 스레드로 다시 던져진다

`af0_manual.cpp`에서 예외를 `exception_ptr`에 손으로 저장했다가 다시 던지는 코드를 짰다. `std::future`는 이 과정을 자동으로 해준다 — 비동기로 실행한 함수가 예외를 던지면, 그 예외는 함수가 끝난 시점이 아니라 **`get()`을 부르는 시점에, 그 `get()`을 부른 스레드 안에서** 다시 던져진다.

```cpp title="af3_exception.cpp — get()에서 예외가 다시 던져진다"
#include <future>
#include <iostream>
#include <stdexcept>

int risky_compute(int x) {
    if (x < 0) throw std::runtime_error("음수는 계산할 수 없다");
    return x * x;
}

int main() {
    std::future<int> fut = std::async(std::launch::async, risky_compute, -5);
    std::cout << "async 호출 직후 -- 예외는 아직 아무 데도 안 보인다\n";
    try {
        int result = fut.get();   // 던져진 예외가 바로 여기서, 이 스레드에서 다시 던져진다
        std::cout << "결과: " << result << "\n";
    } catch (const std::exception& e) {
        std::cout << "get()에서 잡은 예외: " << e.what() << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af3_exception.cpp -o af3_exception -lpthread
$ ./af3_exception
async 호출 직후 -- 예외는 아직 아무 데도 안 보인다
get()에서 잡은 예외: 음수는 계산할 수 없다
```

(g++ 13.3.0 실측.) `risky_compute(-5)`는 **별도 스레드 안에서** 예외를 던졌다. 그 예외를 던진 스레드는 곧바로 종료됐고, 예외는 `main()` 스레드로 넘어와 `try`/`catch`에 잡혔다 — `af0_manual.cpp`에서 `current_exception()`/`rethrow_exception()`으로 손수 하던 일을 `future`가 내부에서 대신 해준 것이다. 만약 `get()`을 한 번도 안 불렀다면, 이 예외는 아무에게도 전달되지 않고 `future`의 공유 상태 안에 그대로 남는다 — 예외가 났다는 사실 자체는 `get()`을 실제로 부르기 전까지는 드러나지 않는다.

## get()은 한 번만 — 두 번째 호출의 실제 결과

`future::get()`은 값을 **꺼내오는** 동작이다 — 읽고 나면 공유 상태의 값이 그 자리에 그대로 남아있는 게 아니라, 그 시점에 상태 자체가 소비된다. 그래서 같은 `future`에 `get()`을 두 번 부르면 무슨 일이 나는지 직접 확인한다.

```cpp title="af4_get_twice.cpp — get()을 두 번 부른다"
#include <future>
#include <iostream>

int main() {
    std::future<int> fut = std::async(std::launch::async, [] { return 42; });
    int first = fut.get();
    std::cout << "첫 번째 get(): " << first << "\n";
    try {
        int second = fut.get();   // 두 번째 호출 -- future의 공유 상태는 이미 비워졌다
        std::cout << "두 번째 get(): " << second << "\n";
    } catch (const std::future_error& e) {
        std::cout << "두 번째 get()에서 예외: " << e.what()
                  << " (code = " << e.code() << ")\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af4_get_twice.cpp -o af4_get_twice -lpthread
$ ./af4_get_twice
첫 번째 get(): 42
두 번째 get()에서 예외: std::future_error: No associated state (code = future:3)
```

(g++ 13.3.0 / Ubuntu 24.04 실측.) 첫 번째 `get()`은 정상적으로 42를 돌려주지만, 두 번째 `get()`은 `std::future_error`를 던진다. 이 라이브러리 구현에서는 "No associated state"라는 메시지가 나왔다 — 첫 번째 `get()`이 공유 상태를 이미 소비해서, `future` 객체는 더 이상 유효한 결과를 참조하고 있지 않다는 뜻이다. `std::thread` 하나를 여러 번 `join()`하려 하면 정적 단언이나 런타임 에러로 막히는 것과 같은 종류의 규칙이다 — "한 번 받으면 끝"이라는 소비 시맨틱을 `future`도 그대로 갖는다. 이미 값을 받았는지 미리 확인하고 싶으면 `fut.valid()`로 이 `future`가 아직 유효한 공유 상태를 참조하고 있는지 먼저 물어봐라.

## std::promise와 std::packaged_task: async 없이 수동으로 잇는다

`std::async`는 "함수를 지금 당장 실행하고 결과를 받는다"는 흐름 전체를 한 번에 처리한다. 그런데 실전에서는 스레드가 **이미 다른 이유로 돌고 있는데**, 그 스레드에게 "이번 작업 하나의 결과만 나중에 달라"고 요청해야 하는 경우가 있다 — 스레드 풀의 워커나, 이미 실행 중인 이벤트 루프가 그렇다. 이럴 때 `std::async`로는 새 실행을 만들 수만 있지, 이미 도는 스레드에 결과 전달 통로만 얹을 수는 없다. `std::promise`가 이 통로다 — `promise` 쪽에서 값을 `set_value()`로 채우면, 짝을 이루는 `future` 쪽에서 그 값을 받는다.

```cpp title="af5_promise.cpp — promise로 값을 채우고 다른 스레드의 future로 받는다"
#include <future>
#include <iostream>
#include <thread>
#include <chrono>

// 워커는 이미 다른 이유로 스레드에서 계속 돌고 있고,
// "이번 작업 하나"의 결과만 나중에 다른 스레드가 받아야 하는 상황을 흉내낸다.
void worker(std::promise<int> result_promise, int input) {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));  // 시간이 걸리는 작업 흉내
    result_promise.set_value(input * input);   // future 쪽에 값을 밀어 넣는다
}

int main() {
    std::promise<int> prom;
    std::future<int> fut = prom.get_future();   // promise와 future는 한 쌍이다

    std::thread t(worker, std::move(prom), 9);   // promise는 이동만 가능하다

    std::cout << "worker가 끝나길 기다리는 동안 다른 일을 할 수 있다\n";
    int result = fut.get();   // worker가 set_value를 부를 때까지 여기서 블록
    std::cout << "promise로 받은 결과: " << result << "\n";

    t.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af5_promise.cpp -o af5_promise -lpthread
$ ./af5_promise
worker가 끝나길 기다리는 동안 다른 일을 할 수 있다
promise로 받은 결과: 81
```

(g++ 13.3.0 실측.) `prom.get_future()`로 미리 짝지어 둔 `future`를 `main()`이 갖고, `promise` 본체는 `std::move`로 워커 스레드에 넘긴다. `promise`도 `packaged_task`도 복사할 수 없다 — [6.1](#/threads)에서 `std::thread` 자체가 복사 불가였던 것과 같은 이유(소유권이 하나로 정해져 있어야 하는 자원이기 때문)다. `set_value()`가 불리는 순간 `fut.get()`의 대기가 풀린다 — `worker`가 몇 ms 걸리든 상관없이, 값이 채워지는 그 순간이 신호다.

콜러블 자체를 나중에 아무 스레드에서나 실행하고 싶다면, `promise`를 손으로 짝짓는 대신 `std::packaged_task`로 함수와 그 결과 전달 통로를 한 번에 묶을 수 있다 — 스레드 풀에서 "작업 하나"를 큐에 넣었다가 워커가 꺼내 실행하는 구조의 기본 뼈대가 이거다.

```cpp title="af8_packaged_task.cpp — 태스크를 큐에 넣어뒀다가 워커가 꺼내 실행한다"
#include <future>
#include <thread>
#include <queue>
#include <iostream>

int square(int x) { return x * x; }

int main() {
    // packaged_task는 "호출 가능한 것 + 그 결과를 담을 promise"를 하나로 묶는다.
    std::packaged_task<int(int)> task(square);
    std::future<int> fut = task.get_future();   // 태스크와 future를 먼저 분리해 둔다

    // task 자체를 큐에 넣어뒀다가, 나중에(다른 스레드에서) 실행할 수 있다 -- 스레드 풀의 기본 뼈대
    std::queue<std::packaged_task<int(int)>> task_queue;
    task_queue.push(std::move(task));   // packaged_task는 이동만 가능하다 -- std::promise와 같다

    std::thread worker([&task_queue] {
        auto t = std::move(task_queue.front());
        task_queue.pop();
        t(6);   // 호출하는 순간 내부 promise에 결과(36)가 set_value된다
    });

    std::cout << "큐에서 꺼내 실행된 태스크의 결과: " << fut.get() << "\n";
    worker.join();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra af8_packaged_task.cpp -o af8_packaged_task -lpthread
$ ./af8_packaged_task
큐에서 꺼내 실행된 태스크의 결과: 36
```

(g++ 13.3.0 실측.) `task(6)`을 호출하는 시점과 `task`를 만든 시점이 완전히 분리돼 있다 — `get_future()`로 미리 결과 통로를 확보해 두고, 실제 함수 호출은 전혀 다른 스레드(여기서는 워커)가 원할 때 한다. `std::promise`를 직접 쓰는 것과 `std::packaged_task`를 쓰는 것의 차이는 이거다: `promise`는 값을 채우는 동작(`set_value`) 자체를 코드 안에서 직접 짜야 하고, `packaged_task`는 그 대신 "이 콜러블을 호출하면" 반환값이 알아서 내부 `promise`에 채워진다 — 콜러블 하나를 그대로 태스크 단위로 옮기고 싶을 때는 `packaged_task` 쪽이 손이 덜 간다.

::: note 여러 스레드가 같은 결과를 기다려야 한다면: shared_future
`std::future`는 `get()`을 한 번만 부를 수 있고, 복사할 수 없고 이동만 된다 — 결과를 받을 소비자가 하나로 정해져 있다는 전제다. 소비자가 여럿이어야 한다면(예: 계산 결과 하나를 세 개의 워커 스레드가 각자 필요해서 기다리는 경우) `future::share()`로 `std::shared_future`를 만든다. `shared_future`는 복사할 수 있고, 복사본마다 `get()`을 각자 불러도 되며, 다들 같은 값을 받는다(`shared_ptr`의 참조 카운트 모델과 비슷한 감각이다 — [2.10 shared_ptr](#/shared-ptr) 참고). `promise` 하나에 `get_future().share()`를 걸어 세 스레드에 뿌리면, `set_value()`가 불리는 순간 셋 다 동시에 깨어나 같은 값을 받는다.
:::

## std::async의 실제 비용 — 여전히 스레드 하나 만드는 값이다

`std::async(std::launch::async, ...)`가 함수 호출처럼 간단해 보인다고 해서 그 비용까지 함수 호출 수준인 건 아니다. [6.1](#/threads)의 `th2_cost.cpp`에서 스레드 하나를 생성+join하는 데 마이크로초 단위 비용이 든다는 걸 실측했다 — `std::async(std::launch::async, ...)`는 그 밑에서 결국 스레드를 하나 만든다. 함수 호출, `std::thread` 직접 생성, `std::async` 셋을 같은 조건(1만 회 반복)으로 나란히 잰다.

```cpp title="af7_cost.cpp — 함수 호출 vs thread 생성 vs async, 1만 회 반복"
#include <future>
#include <thread>
#include <chrono>
#include <iostream>

int main() {
    const int N = 10000;

    // 함수 직접 호출
    auto t0 = std::chrono::steady_clock::now();
    long long sum1 = 0;
    for (int i = 0; i < N; ++i) sum1 += i * i;
    auto t1 = std::chrono::steady_clock::now();

    // std::thread 직접 생성 + join
    auto t2 = std::chrono::steady_clock::now();
    long long sum2 = 0;
    for (int i = 0; i < N; ++i) {
        int local = 0;
        std::thread th([&] { local = i * i; });
        th.join();
        sum2 += local;
    }
    auto t3 = std::chrono::steady_clock::now();

    // std::async(launch::async)
    auto t4 = std::chrono::steady_clock::now();
    long long sum3 = 0;
    for (int i = 0; i < N; ++i) {
        auto fut = std::async(std::launch::async, [i] { return i * i; });
        sum3 += fut.get();
    }
    auto t5 = std::chrono::steady_clock::now();

    auto ns = [](auto d) { return std::chrono::duration_cast<std::chrono::nanoseconds>(d).count(); };
    std::cout << "함수 호출 " << N << "회        : 1회당 " << (double)ns(t1 - t0) / N << " ns\n";
    std::cout << "thread 생성+join " << N << "회 : 1회당 " << (double)ns(t3 - t2) / N << " ns\n";
    std::cout << "std::async " << N << "회        : 1회당 " << (double)ns(t5 - t4) / N << " ns\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -O2 -Wall -Wextra af7_cost.cpp -o af7_cost -lpthread
$ ./af7_cost
함수 호출 10000회        : 1회당 0.5479 ns
thread 생성+join 10000회 : 1회당 90565.2 ns
std::async 10000회        : 1회당 69631.5 ns
```

::: perf async는 스레드 생성 비용을 없애주지 않는다
(g++ 13.3.0 / `-O2` / Ubuntu 24.04 x86-64 실측, 3회 반복에서 함수 호출은 항상 1ns 미만, `thread`는 69,856~90,565ns, `async`는 52,155~69,631ns 사이였다.) 함수 호출은 나노초 미만, `std::thread` 직접 생성은 마이크로초 수십 개, `std::async`도 마이크로초 수십 개다 — `async`가 `thread`보다 약간 싸게 나온 경우도 있었지만 **같은 자릿수**이지 함수 호출 수준으로 내려가지는 않는다. 이유는 단순하다 — `std::launch::async`를 명시하면 표준 구현은 결국 OS 스레드를 새로 하나 만든다. `std::async`가 없애주는 건 "결과 저장·예외 전달을 손으로 짜는 수고"이지 "스레드 하나를 만드는 비용" 자체가 아니다. 그래서 반복문 안에서 가벼운 계산 하나마다 `std::async`를 새로 부르는 설계는 [6.1](#/threads)에서 이미 내린 결론(반복되는 작은 작업마다 스레드를 새로 만들지 마라)과 똑같이 잘못된 설계다 — 태스크가 가벼우면 스레드 풀에 미리 만들어 둔 워커에게 `packaged_task`로 맡기는 쪽이 맞다.
:::

## 로보틱스 연결: 여러 소스에서 독립적으로 값을 모을 때

헥사포드 같은 로봇이 여러 센서(IMU, 각 다리의 인코더, 거리 센서)에서 값을 읽어 하나의 상태로 합쳐야 하는 상황을 생각해 본다. 센서마다 읽기 지연이 다르다면, 하나씩 순서대로 읽는 것보다 `std::async(std::launch::async, ...)`로 각 센서 읽기를 동시에 띄우고 `future::get()`으로 결과들을 모으는 편이 전체 대기 시간을 줄인다 — 다만 이 절에서 실측했듯 센서마다 스레드를 새로 만드는 비용이 있으므로, 주기가 아주 짧은 제어 루프 안에서는 [6.9 스레드 아키텍처 설계](#/thread-architecture)에서 다룰 미리 만들어 둔 워커 스레드 쪽이 더 맞는 설계다. rclcpp의 비동기 서비스 클라이언트(`async_send_request`)도 개념적으로 정확히 이 패턴이다 — 요청을 보내는 즉시 결과가 아직 없는 핸들을 돌려받고, 나중에 응답이 도착했을 때 그 핸들에서 값을 꺼낸다는 점에서 `std::future`와 같은 역할을 한다. `rclcpp`의 실제 서비스 API는 [10.3 서비스와 액션](#/services-actions)에서 다룬다.

::: interview "std::thread 대신 std::async를 쓰는 이유가 뭔가"
답변 뼈대: ① `std::async`는 결과값 하나를 비동기로 계산해서 받는다는 목적에 최적화된 도구다 — 결과 저장, 동기화, 예외 전달을 표준 라이브러리가 대신 처리한다(이 절의 `af0_manual.cpp`가 그 수고를 직접 보여준다). `std::thread`는 이 목적에 쓰기엔 지나치게 저수준이다. ② 다만 `std::async`가 스레드 생성 비용 자체를 없애주는 건 아니다 — `launch::async`를 명시하면 내부적으로 여전히 스레드를 하나 만든다(이 절의 실측: `thread`와 같은 자릿수인 수십 마이크로초). ③ 예외 처리가 자동이라는 점이 실무에서 크다 — 함수가 던진 예외가 `get()`을 부르는 시점에 호출자 스레드에서 그대로 다시 던져진다(`af3_exception.cpp`). ④ 실행 정책을 명시하지 않으면 `deferred`로 미뤄질 수도 있다는 함정, `async`가 돌려준 `future`를 변수에 안 받으면 그 임시 객체의 소멸자가 블록한다는 함정(`af9_discard.cpp`)까지 짚으면 완전한 답이 된다.
:::

## 요약

- `std::thread`만으로 결과값 하나와 예외를 받으려면 저장소, 뮤텍스, `exception_ptr`까지 손으로 준비해야 한다(실측: `af0_manual.cpp`). `std::async`/`std::future`는 이 세 가지를 대신해 준다.
- `std::launch::async`는 반드시 별도 스레드에서 즉시 실행되고, `std::launch::deferred`는 `get()`을 부르는 시점에 그 호출자 스레드 위에서 지연 실행된다 — 스레드 id를 찍어 실측으로 확인했다(`af2_launch_policy.cpp`).
- 비동기로 실행한 함수가 던진 예외는 `future::get()`을 부르는 시점에 호출자 스레드에서 그대로 다시 던져진다(실측: `af3_exception.cpp`).
- `future::get()`은 공유 상태를 소비하는 동작이라 한 번만 부를 수 있다 — 두 번째 호출은 `std::future_error`를 던진다(실측: `af4_get_twice.cpp`, "No associated state").
- `std::promise`/`std::future` 쌍은 이미 실행 중인 스레드에게 나중에 결과만 요청해야 할 때 쓴다(실측: `af5_promise.cpp`). `std::packaged_task`는 콜러블과 그 결과 전달 통로를 한 번에 묶어 큐에 넣었다가 워커가 꺼내 실행하는 구조에 맞다(실측: `af8_packaged_task.cpp`).
- 소비자가 여럿이어야 하면 `future::share()`로 `std::shared_future`를 만든다 — 복사가 되고, 각 복사본에서 `get()`을 각자 불러도 모두 같은 값을 받는다.
- `std::async(std::launch::async, ...)`도 결국 스레드를 하나 만들므로 비용은 `std::thread` 직접 생성과 같은 자릿수(수십 마이크로초)다(실측: `af7_cost.cpp`) — 가벼운 계산 하나마다 `async`를 새로 부르는 건 여전히 무거운 설계다.
- `async`가 돌려준 `future`를 변수에 받지 않으면 그 임시 객체의 소멸자가 작업이 끝날 때까지 블록한다(실측: `af9_discard.cpp`) — 다른 모든 `future`의 소멸자는 블록하지 않는다는 것과 정반대인 함정이다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·실행으로 확인하는 실습이다.

1. `af0_manual.cpp`와 `af1_basic.cpp`를 비교해서, `std::async`/`std::future`가 `std::thread`를 직접 쓰는 것 대비 정확히 어떤 수고를 없애주는지 세 가지로 나눠 설명하라.

2. `std::launch::async`와 `std::launch::deferred`의 차이를 "어느 스레드에서, 언제 실행되는가"의 관점에서 설명하고, `af2_launch_policy.cpp`의 실측 결과(스레드 id) 중 어느 부분이 그 차이를 보여주는지 짚어라.

3. (예측) 다음 코드를 컴파일하지 말고 무슨 일이 일어날지 예측하고 근거를 써라.

   ```cpp
   std::future<int> make_future() {
       return std::async(std::launch::async, [] {
           std::this_thread::sleep_for(std::chrono::milliseconds(200));
           return 1;
       });
   }

   int main() {
       auto fut = make_future();
       std::cout << "대기 시작\n";
       int v = fut.get();
       std::cout << "받은 값: " << v << "\n";
   }
   ```

   힌트: `af9_discard.cpp`와 달리 여기서는 `future`를 `fut`라는 변수에 받아 뒀다.

4. (실습, 코드 작성형) `std::promise<int>`와 `std::packaged_task<int(int)>`를 각각 사용하는 두 개의 짧은 프로그램을 작성하라. 첫 번째는 이 절의 `af5_promise.cpp`처럼 워커 스레드가 `set_value()`로 결과를 채우고 `main()`이 `future::get()`으로 받는 구조로, 두 번째는 `af8_packaged_task.cpp`처럼 태스크를 컨테이너(큐나 벡터)에 넣었다가 다른 스레드가 꺼내 실행하는 구조로 짜라. 성공 기준: 두 프로그램 모두 `g++ -std=c++20 -Wall -Wextra -fsanitize=thread <파일> -o <출력> -lpthread`로 컴파일·실행했을 때 경고·TSan 경고 없이 기대한 값을 출력한다.
:::

::: answer 해설
1. ① 결과 저장소: `af0_manual.cpp`는 `Result` 구조체를 직접 선언해야 했지만 `std::future<int>`가 이 역할을 대신한다. ② 동기화: `af0_manual.cpp`는 `std::mutex`로 그 저장소를 두 스레드가 동시에 건드리지 않게 지켰지만, `future`/`promise`의 공유 상태는 라이브러리 내부에서 이미 스레드 안전하게 관리된다. ③ 예외 전달: `af0_manual.cpp`는 `exception_ptr`/`current_exception()`/`rethrow_exception()`을 직접 써서 예외를 저장했다가 다시 던졌지만, `future::get()`은 이 과정을 자동으로 해 준다(`af3_exception.cpp`).
2. `std::launch::async`는 `async`를 부르는 즉시 별도의 OS 스레드가 생성돼 그 위에서 함수가 바로 실행된다 — `af2_launch_policy.cpp`에서 `launch::async` 실행 스레드 id가 `main()`의 id와 달랐던 것이 이 증거다. `std::launch::deferred`는 `async`를 부르는 시점에는 아무 실행도 일어나지 않고, `get()`을 부르는 바로 그 순간에 그 `get()`을 부른 스레드 위에서 함수가 실행된다 — `deferred` 실행 스레드 id가 `main()`의 id와 정확히 같았던 것이 이 증거다. 요약하면 `async`는 "동시에, 다른 곳에서", `deferred`는 "필요할 때, 여기서"다.
3. 문제없이 정상 작동한다. `af9_discard.cpp`의 함정은 `async`가 돌려준 `future`를 **어디에도 받지 않고 그 자리에서 버렸을 때**만 발생한다 — 이름 없는 임시 객체는 그 표현식이 포함된 문장이 끝나는 순간 소멸되고, `launch::async`로 만든 `future`의 소멸자는 예외적으로 작업이 끝날 때까지 블록하기 때문이다. 이 코드는 `make_future()`의 반환값을 `main()`의 `fut`라는 지역 변수로 제대로 받았으므로, `fut`는 `main()`의 `fut.get()` 호출까지 살아있고 그 소멸자가 블록을 일으킬 일도 없다 — 다만 `fut.get()`을 부르면 200ms 뒤 1을 정상적으로 돌려받는다. 함정은 "future의 소멸자가 원래 블록한다"가 아니라 "받지 않고 버렸을 때만 블록한다"는 것이다.
4. 첫 번째 프로그램은 `af5_promise.cpp`처럼 `std::promise<int>`를 워커 스레드로 `std::move`해서 넘기고, 워커가 `set_value()`를 부른 뒤 `main()`의 `future::get()`이 그 값을 정확히 받아야 한다. 두 번째 프로그램은 `af8_packaged_task.cpp`처럼 `packaged_task`를 컨테이너에 `std::move`로 넣었다가, 다른 스레드가 그걸 꺼내 호출한 뒤 `future::get()`으로 결과를 받는 구조여야 한다 — 둘 다 `promise`/`packaged_task`가 이동만 가능하다는 점을 반영했다면 완전한 구현이다. TSan은 `promise`/`future`의 공유 상태 접근이 라이브러리 내부에서 이미 동기화돼 있으므로 경고 없이 통과해야 한다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `af2_launch_policy.cpp`와 `af9_discard.cpp`는 "글로 설명 들은 것"과 "네 터미널에서 스레드 id가 실제로 같은지 다른지, 출력 순서가 실제로 어떻게 나오는지 직접 본 것" 사이의 체감 차이가 크다. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main -lpthread && ./main`. `af5_promise.cpp`나 `af8_packaged_task.cpp`처럼 여러 스레드가 공유 상태를 주고받는 코드는 `-fsanitize=thread`를 추가해서 한 번 더 돌려봐라: `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra main.cpp -o main -lpthread && ./main`.

**다음 절**: [6.8 실시간 제약과 제어 루프](#/realtime) — 지금까지 본 스레드·락·atomic·future가 실시간 제어 루프 안에서는 왜 그대로 쓰기 위험한지, malloc과 락을 피해야 하는 이유를 본다.
