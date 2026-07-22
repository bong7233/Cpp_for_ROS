# 2.10 shared_ptr와 weak_ptr

::: lead
[2.9](#/unique-ptr)는 소유자가 하나뿐이라는 규칙으로 이중 해제·소유권 불명을 컴파일 타임에 지웠다. 그런데 소유자가 정말 둘 이상이어야 하는 경우가 있다 — 여러 센서 콜백이 같은 캘리브레이션 데이터를 동시에 읽어야 하고, 그중 어느 콜백이 마지막으로 해제되는지는 컴파일 타임이 아니라 실행 중에야 정해진다. `unique_ptr`는 이 상황을 표현할 수 없다. 이 절은 `std::shared_ptr`가 참조 카운트로 이 문제를 어떻게 푸는지, 그 대가로 무엇을 치르는지, 그리고 참조 카운트만으로는 못 막는 함정(순환 참조)을 실측으로 확인한다.
:::

## unique_ptr로는 표현할 수 없는 소유권

이런 구조를 짜 본다. IMU 노드와 라이다 노드가 둘 다 같은 캘리브레이션 데이터를 읽어야 한다. `unique_ptr`로 짜면 소유권은 둘 중 하나에만 갈 수 있다 — 문법은 통과하지만 의미가 깨진다.

```cpp title="uptr_two_owners.cpp — 컴파일은 되지만 두 번째 노드가 빈 소유권을 받는다"
#include <cstdio>
#include <memory>
#include <utility>

struct Calibration {
    double offset[4];
};

class SensorNode {
public:
    SensorNode(const char* name, std::unique_ptr<Calibration> calib)
        : name_(name), calib_(std::move(calib)) {}

    void read() const {
        std::printf("[%s] offset[0] = %.2f\n", name_, calib_->offset[0]);
        std::fflush(stdout);
    }

private:
    const char* name_;
    std::unique_ptr<Calibration> calib_;
};

int main() {
    auto calib = std::make_unique<Calibration>();
    calib->offset[0] = 1.5;

    SensorNode imu_node("imu", std::move(calib));     // 소유권이 imu_node로 이동
    SensorNode lidar_node("lidar", std::move(calib));  // calib는 이미 비었다 — 컴파일은 통과한다

    imu_node.read();
    lidar_node.read();   // calib_ == nullptr 역참조
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address uptr_two_owners.cpp -o uptr_two_owners
$ ./uptr_two_owners
[imu] offset[0] = 1.50
AddressSanitizer:DEADLYSIGNAL
=================================================================
==5948==ERROR: AddressSanitizer: SEGV on unknown address 0x000000000000
==5948==The signal is caused by a READ memory access.
    #0 ... in SensorNode::read() const uptr_two_owners.cpp:15
    #1 ... in main uptr_two_owners.cpp:32
SUMMARY: AddressSanitizer: SEGV ... in SensorNode::read() const
==5948==ABORTING
$ echo $?
1
```

(g++ 13.3 / Linux x86-64 실측.) `imu_node`는 정상 출력됐다. `lidar_node`는 두 번째 `std::move(calib)`가 이미 빈 `unique_ptr`(2.9에서 확인했듯 이동 후 항상 `nullptr`)을 받아 `calib_`가 `nullptr`이었고, `read()`가 그걸 역참조해 즉시 죽었다. **이건 버그를 짠 게 아니다** — "두 노드가 같은 데이터를 읽는다"는 요구 자체가 `unique_ptr`의 "소유자는 하나"라는 전제와 충돌한다. `unique_ptr`를 복사해서 우회하려 해도 [2.9](#/unique-ptr)에서 본 대로 복사 생성자가 `= delete`라 컴파일조차 안 된다.

`std::shared_ptr`로 바꾸면 이 구조가 그대로 성립한다.

```cpp title="sptr_two_owners_fixed.cpp — 셋이 동시에 소유한다"
#include <cstdio>
#include <memory>

struct Calibration {
    double offset[4];
};

class SensorNode {
public:
    SensorNode(const char* name, std::shared_ptr<Calibration> calib)
        : name_(name), calib_(std::move(calib)) {}

    void read() const {
        std::printf("[%s] offset[0] = %.2f  (use_count = %ld)\n",
                     name_, calib_->offset[0], calib_.use_count());
        std::fflush(stdout);
    }

private:
    const char* name_;
    std::shared_ptr<Calibration> calib_;
};

int main() {
    auto calib = std::make_shared<Calibration>();
    calib->offset[0] = 1.5;

    SensorNode imu_node("imu", calib);      // 복사 — use_count 증가
    SensorNode lidar_node("lidar", calib);  // 또 복사 — use_count 더 증가

    imu_node.read();
    lidar_node.read();
    std::printf("main의 calib.use_count() = %ld\n", calib.use_count());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address sptr_two_owners_fixed.cpp -o sptr_two_owners_fixed
$ ./sptr_two_owners_fixed
[imu] offset[0] = 1.50  (use_count = 3)
[lidar] offset[0] = 1.50  (use_count = 3)
main의 calib.use_count() = 3
$ echo $?
0
```

(g++ 13.3 실측.) `main`의 `calib`, `imu_node`의 `calib_`, `lidar_node`의 `calib_` — 셋 모두 같은 `Calibration` 객체를 가리키고, `use_count()`가 정확히 3을 센다. 소유자가 몇이든, 마지막 하나가 스코프를 벗어날 때 실제 `delete`가 불린다. **"누가 마지막인지"를 컴파일 타임에 정할 필요가 없다** — 그게 이 절의 주제다.

## 참조 카운트의 정체: 제어 블록

`shared_ptr`가 카운트를 세는 방식을 직접 들여다본다.

```cpp title="sptr_usecount.cpp"
#include <cstdio>
#include <memory>

void print_count(const char* label, const std::shared_ptr<int>& p) {
    std::printf("%-24s use_count() = %ld\n", label, p.use_count());
}

int main() {
    auto a = std::make_shared<int>(42);
    print_count("a 생성 직후", a);
    {
        auto b = a;   // 복사 1
        print_count("b = a 복사 직후", a);
        auto c = b;   // 복사 2
        print_count("c = b 복사 직후", a);
    }   // b, c 소멸
    print_count("내부 스코프 벗어난 뒤", a);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g sptr_usecount.cpp -o sptr_usecount
$ ./sptr_usecount
a 생성 직후          use_count() = 1
b = a 복사 직후      use_count() = 2
c = b 복사 직후      use_count() = 3
내부 스코프 벗어난 뒤 use_count() = 1
```

(g++ 13.3 실측.) 복사할 때마다 1씩 오르고, `b`·`c`가 스코프를 벗어날 때마다 1씩 내려갔다 — 0이 되는 순간(여기서는 `a`도 소멸하는 `main` 끝) 실제 객체가 `delete`된다. 이 숫자는 어디에 있는가. `shared_ptr` 자신이 아니라, 힙에 별도로 만들어지는 **제어 블록(control block)**에 있다. `sizeof`로 실측한다.

```cpp title="sptr_sizeof.cpp"
#include <cstdio>
#include <memory>

int main() {
    std::printf("sizeof(int*)                  = %zu\n", sizeof(int*));
    std::printf("sizeof(std::unique_ptr<int>)  = %zu\n", sizeof(std::unique_ptr<int>));
    std::printf("sizeof(std::shared_ptr<int>)  = %zu\n", sizeof(std::shared_ptr<int>));
    std::printf("sizeof(std::weak_ptr<int>)    = %zu\n", sizeof(std::weak_ptr<int>));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g sptr_sizeof.cpp -o sptr_sizeof
$ ./sptr_sizeof
sizeof(int*)                  = 8
sizeof(std::unique_ptr<int>)  = 8
sizeof(std::shared_ptr<int>)  = 16
sizeof(std::weak_ptr<int>)    = 16
```

(g++ 13.3 / Linux x86-64 실측.) `unique_ptr<int>`는 [2.9](#/unique-ptr)에서 확인했듯 원시 포인터와 같은 8바이트다. `shared_ptr<int>`는 정확히 그 두 배, 16바이트다 — 실제 객체를 가리키는 포인터 하나(8바이트)에, **제어 블록을 가리키는 포인터**(8바이트)가 더 붙는다. 제어 블록 자체는 `shared_ptr`의 크기에 안 잡히고 별도로 힙에 산다. 그 안에 두 개의 카운트(강한 참조 수인 `use_count`, `weak_ptr`용 약한 참조 수)와 딜리터·할당자가 들어간다. `weak_ptr<int>`도 16바이트인 이유가 여기서 나온다 — `weak_ptr`도 객체 포인터와 제어 블록 포인터를 똑같이 들고 있고, 다만 제어 블록의 강한 카운트에는 손대지 않을 뿐이다(뒤에서 실측).

## make_shared vs shared_ptr(new T): 힙 할당 횟수

`shared_ptr<T>(new T())`처럼 직접 `new`로 만들면 객체와 제어 블록이 **각자 다른 힙 블록**으로 따로 할당된다. `std::make_shared<T>()`는 이 둘을 한 번의 할당으로 합친다. `operator new`를 가로채 호출 횟수를 센다.

```cpp title="sptr_alloc_count.cpp"
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <new>

static int alloc_count = 0;

void* operator new(std::size_t sz) {
    ++alloc_count;
    void* p = std::malloc(sz);
    if (!p) throw std::bad_alloc();
    return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

struct Calib { double offset[4]; };

int main() {
    alloc_count = 0;
    { auto p = std::shared_ptr<Calib>(new Calib()); (void)p; }
    std::printf("shared_ptr<Calib>(new Calib()) : operator new 호출 %d회\n", alloc_count);

    alloc_count = 0;
    { auto p = std::make_shared<Calib>(); (void)p; }
    std::printf("make_shared<Calib>()           : operator new 호출 %d회\n", alloc_count);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g sptr_alloc_count.cpp -o sptr_alloc_count
$ ./sptr_alloc_count
shared_ptr<Calib>(new Calib()) : operator new 호출 2회
make_shared<Calib>()           : operator new 호출 1회
```

(g++ 13.3 실측.) `shared_ptr<Calib>(new Calib())`은 `new Calib()`이 객체용으로 한 번, `shared_ptr` 생성자 내부가 제어 블록용으로 또 한 번 — 총 두 번 힙을 두드린다. `make_shared`는 객체와 제어 블록을 이어 붙인 하나의 블록으로 한 번에 할당한다. 할당 횟수가 줄어드는 것 자체도 이득이지만, 더 중요한 건 **캐시 지역성**이다 — 객체와 그 카운트가 같은 캐시 라인 근처에 놓여 `use_count()`를 읽을 때 별도의 캐시 미스가 안 난다. 이 책은 [2.9](#/unique-ptr)에서 `make_unique`를 기본으로 삼은 것과 같은 이유로 `make_shared`를 기본으로 삼는다 — 단, 커스텀 딜리터가 필요하면 `make_shared`는 그 인자를 받지 않으므로 `shared_ptr<T>(new T(), deleter)` 형태로 돌아가야 한다.

::: warn make_shared의 대가 — weak_ptr가 메모리를 더 오래 붙잡을 수 있다
객체와 제어 블록이 한 덩어리이므로, `weak_ptr`가 하나라도 살아있으면 그 블록 전체가 해제되지 못한다 — 객체의 소멸자는 강한 참조가 0이 되는 순간 불리지만(파괴는 됨), 메모리 자체의 반환은 약한 참조까지 0이 될 때까지 미뤄진다. 객체가 아주 크고 `weak_ptr`를 오래 들고 있는 코드라면 `shared_ptr<T>(new T())` 분리 할당이 오히려 나을 수 있다 — 드문 경우이니 기본은 여전히 `make_shared`다.
:::

## 순환 참조: shared_ptr의 진짜 함정

참조 카운트는 "누군가 아직 쓰고 있는가"만 센다. 서로가 서로를 세고 있으면, 아무도 안 쓰는데도 카운트가 0이 되지 않는다.

```cpp title="sptr_cycle_leak.cpp — 부모와 자식이 서로를 shared_ptr로 문다"
#include <cstdio>
#include <memory>

struct Child;

struct Parent {
    std::shared_ptr<Child> child;
    ~Parent() { std::printf("[~Parent]\n"); std::fflush(stdout); }
};

struct Child {
    std::shared_ptr<Parent> parent;   // ❌ 부모를 shared_ptr로 되잡는다
    ~Child() { std::printf("[~Child]\n"); std::fflush(stdout); }
};

int main() {
    {
        auto p = std::make_shared<Parent>();
        auto c = std::make_shared<Child>();
        p->child = c;
        c->parent = p;

        std::printf("p.use_count() = %ld\n", p.use_count());
        std::printf("c.use_count() = %ld\n", c.use_count());
        std::fflush(stdout);
    }   // p, c 지역변수는 여기서 소멸하지만...
    std::printf("스코프 벗어남 — 소멸자 로그가 안 보인다\n");
    std::fflush(stdout);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address sptr_cycle_leak.cpp -o sptr_cycle_leak
$ ./sptr_cycle_leak
p.use_count() = 2
c.use_count() = 2
스코프 벗어남 — 소멸자 로그가 안 보인다

=================================================================
==30677==ERROR: LeakSanitizer: detected memory leaks

Indirect leak of 32 byte(s) in 1 object(s) allocated from:
    #0 ... in operator new(unsigned long) ...
    #8 ... in std::shared_ptr<Child> std::make_shared<Child>() ...
    #9 ... in main sptr_cycle_leak.cpp:19

Indirect leak of 32 byte(s) in 1 object(s) allocated from:
    #0 ... in operator new(unsigned long) ...
    #8 ... in std::shared_ptr<Parent> std::make_shared<Parent>() ...
    #9 ... in main sptr_cycle_leak.cpp:18

SUMMARY: AddressSanitizer: 64 byte(s) leaked in 2 allocation(s).
$ echo $?
1
```

(g++ 13.3 / Linux x86-64 실측.) `p.use_count()`가 2다 — `main`의 `p` 하나, 그리고 `c->parent`가 하나, 합쳐서 2. `c.use_count()`도 마찬가지로 2다. 블록을 빠져나가며 지역변수 `p`, `c`가 소멸해도 각각 카운트가 2에서 1로 내려갈 뿐이다 — **서로가 쥔 마지막 1이 절대 안 풀린다.** `[~Parent]`도 `[~Child]`도 출력되지 않았다. LeakSanitizer가 `Indirect leak`(직접 들고 있던 포인터가 아니라 그 포인터가 가리키는 객체 안에서 새는 것) 32바이트 두 건, 총 64바이트를 정확히 잡아냈다. **이게 shared_ptr의 진짜 함정이다** — 컴파일도 통과하고, 카운트도 정상적으로 오르내리는 것처럼 보이는데, 그래프에 순환이 있으면 소멸이 영원히 안 일어난다.

## weak_ptr로 순환을 끊는다

관계에 방향이 있다면(부모가 자식을 소유하지, 자식이 부모를 소유하지는 않는다) 역방향 포인터를 `weak_ptr`로 바꾼다. `weak_ptr`는 제어 블록의 **약한 카운트**만 올릴 뿐, 강한 카운트(=`use_count()`가 보는 값)에는 손대지 않는다.

```cpp title="sptr_cycle_fixed.cpp — 부모→자식은 shared_ptr, 자식→부모는 weak_ptr"
#include <cstdio>
#include <memory>

struct Child;

struct Parent {
    std::shared_ptr<Child> child;
    ~Parent() { std::printf("[~Parent]\n"); std::fflush(stdout); }
};

struct Child {
    std::weak_ptr<Parent> parent;   // ✅ 부모는 weak_ptr — 카운트에 안 잡힌다
    ~Child() { std::printf("[~Child]\n"); std::fflush(stdout); }
};

int main() {
    {
        auto p = std::make_shared<Parent>();
        auto c = std::make_shared<Child>();
        p->child = c;
        c->parent = p;

        std::printf("p.use_count() = %ld\n", p.use_count());
        std::printf("c.use_count() = %ld\n", c.use_count());
    }
    std::printf("스코프 벗어남\n");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address sptr_cycle_fixed.cpp -o sptr_cycle_fixed
$ ./sptr_cycle_fixed
p.use_count() = 1
c.use_count() = 2
[~Parent]
[~Child]
스코프 벗어남
$ echo $?
0
```

(g++ 13.3 실측.) `p.use_count()`가 1로 줄었다 — `c->parent`가 이제 `weak_ptr`라 카운트를 안 세기 때문이다. `c.use_count()`는 여전히 2다(`main`의 `c`, 그리고 `p->child`). 블록을 나가며 지역변수는 선언 역순(`c` 먼저, `p` 나중)으로 소멸한다. `c` 소멸은 `Child`의 카운트를 2에서 1로만 내리고(`p->child`가 아직 쥐고 있다), 실제 파괴는 안 일어난다. 이어서 `p` 소멸이 `Parent`의 카운트를 1에서 0으로 내려 `~Parent`의 **바디가 먼저** 실행되고("[~Parent]" 출력), 그 직후 `Parent`의 멤버 `child`(마지막까지 `Child`를 쥐고 있던 `shared_ptr`)가 소멸하며 `Child`의 카운트가 0이 되어 연쇄적으로 `~Child`가 불린다("[~Child]" 출력). 두 소멸자 모두 정상 호출됐고 LeakSanitizer는 조용하다(종료 코드 0).

`weak_ptr`가 카운트에 정말 영향을 안 주는지, 그리고 `lock()`이 어떻게 안전하게 접근을 제공하는지 직접 확인한다.

```cpp title="sptr_weak_lock.cpp"
#include <cstdio>
#include <memory>

int main() {
    auto a = std::make_shared<int>(42);
    std::printf("a 생성 직후          use_count = %ld\n", a.use_count());

    std::weak_ptr<int> w = a;
    std::printf("weak_ptr 대입 직후    use_count = %ld  (변화 없음)\n", a.use_count());

    if (auto locked = w.lock()) {
        std::printf("lock() 성공, *locked = %d, use_count = %ld  (임시 shared_ptr 한 개 늘어남)\n",
                     *locked, a.use_count());
    }
    std::printf("lock() 임시객체 소멸 후 use_count = %ld  (원래대로 복귀)\n", a.use_count());

    a.reset();
    std::printf("a.reset() 후 w.expired() = %s\n", w.expired() ? "true" : "false");
    if (auto locked2 = w.lock()) {
        std::printf("여기는 출력되지 않는다\n");
    } else {
        std::printf("lock() 실패 — 원본이 이미 소멸했다\n");
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g sptr_weak_lock.cpp -o sptr_weak_lock
$ ./sptr_weak_lock
a 생성 직후          use_count = 1
weak_ptr 대입 직후    use_count = 1  (변화 없음)
lock() 성공, *locked = 42, use_count = 2  (임시 shared_ptr 한 개 늘어남)
lock() 임시객체 소멸 후 use_count = 1  (원래대로 복귀)
a.reset() 후 w.expired() = true
lock() 실패 — 원본이 이미 소멸했다
```

(g++ 13.3 실측.) `w = a`로 `weak_ptr`를 만들어도 `use_count`는 그대로 1이다 — `weak_ptr`는 관찰만 하지 소유하지 않는다. `w.lock()`은 원본이 아직 살아있으면 **임시 `shared_ptr`**를 만들어 반환한다 — 그 순간만 `use_count`가 2로 올라가고, `if` 문을 빠져나가 임시객체가 소멸하면 다시 1로 돌아온다. `a.reset()`으로 원본을 명시적으로 지운 뒤에는 `w.expired()`가 `true`를 내고, `lock()`은 빈 `shared_ptr`(`if`에서 거짓)을 돌려준다 — `weak_ptr`가 가리키던 객체에 안전하게 "지금 살아있나"를 물어볼 수 있는 유일한 통로다. `w.get()` 같은 것은 없다 — 반드시 `lock()`을 거쳐야 하고, 이게 댕글링 포인터를 원천 차단한다.

## shared_ptr를 기본으로 쓰지 않는 이유

`use_count()`가 오르내리는 연산은 공짜가 아니다. 여러 스레드가 같은 `shared_ptr`를 동시에 복사·소멸시켜도 카운트가 안전하게 세어지려면, 그 증감이 **원자적 연산**이어야 한다(무슨 뜻인지는 [6.5 atomic](#/atomic)에서 다룬다 — 지금은 "그냥 `count++`가 아니라 락 없이도 스레드 안전을 보장하는 특수 명령"이라고만 알아둔다). `unique_ptr`는 셀 것 자체가 없으니 이 비용이 아예 없다. 직접 재 본다.

```cpp title="sptr_perf.cpp — 2000만 회 생성·소멸"
#include <chrono>
#include <cstdio>
#include <memory>

struct Widget { int a, b, c, d; };

int main() {
    constexpr int N = 20'000'000;
    long long sink = 0;

    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < N; ++i) {
        auto p = std::make_unique<Widget>();
        p->a = i;
        sink += p->a;   // 결과를 실제로 사용해 할당 자체가 최적화로 사라지지 않게 한다
    }
    auto t1 = std::chrono::steady_clock::now();

    for (int i = 0; i < N; ++i) {
        auto p = std::make_shared<Widget>();
        p->a = i;
        sink += p->a;
    }
    auto t2 = std::chrono::steady_clock::now();

    auto us_unique = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    auto us_shared = std::chrono::duration_cast<std::chrono::microseconds>(t2 - t1).count();
    std::printf("unique_ptr %d회 생성/소멸: %lld us (평균 %.2f ns/회)\n",
                N, (long long)us_unique, (double)us_unique * 1000.0 / N);
    std::printf("shared_ptr %d회 생성/소멸: %lld us (평균 %.2f ns/회)\n",
                N, (long long)us_shared, (double)us_shared * 1000.0 / N);
    std::printf("배율: shared_ptr가 unique_ptr의 %.2f배\n", (double)us_shared / us_unique);
    std::printf("sink = %lld (최적화로 루프가 사라지지 않았음을 보증)\n", sink);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 sptr_perf.cpp -o sptr_perf_O0
$ ./sptr_perf_O0
unique_ptr 20000000회 생성/소멸: 2338429 us (평균 116.92 ns/회)
shared_ptr 20000000회 생성/소멸: 3020629 us (평균 151.03 ns/회)
배율: shared_ptr가 unique_ptr의 1.29배
sink = 399999980000000 (최적화로 루프가 사라지지 않았음을 보증)
```

(g++ 13.3 / -O0 / Linux x86-64 실측. 절대값은 기기마다 다르지만 배율의 자릿수는 어디서나 비슷하다.) 최적화를 끈 상태에서는 `shared_ptr`가 `unique_ptr`보다 약 1.3배 느리다 — 제어 블록 할당·해제와 카운트 증감이 매 반복 더 붙기 때문이다. `-O2`로 다시 재면 더 흥미로운 그림이 나온다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 sptr_perf.cpp -o sptr_perf
$ ./sptr_perf
unique_ptr 20000000회 생성/소멸: 0 us (평균 0.00 ns/회)
shared_ptr 20000000회 생성/소멸: 277242 us (평균 13.86 ns/회)
배율: shared_ptr가 unique_ptr의 inf배
sink = 399999980000000 (최적화로 루프가 사라지지 않았음을 보증)
```

::: perf -O2에서 unique_ptr 루프가 통째로 사라졌다
`unique_ptr` 루프는 0us로 측정됐다 — 시간이 짧아서가 아니라, GCC가 `new`/`delete` 쌍이 루프 바깥으로 전혀 관찰되지 않는다는 것을 증명하고 **힙 할당 자체를 통째로 제거**했기 때문이다(대체 가능한 전역 `operator new`/`delete`를 오버라이드하지 않았으므로 컴파일러가 이 소거를 허용한다). `shared_ptr` 루프는 같은 조건에서도 사라지지 않고 13.86ns/회가 그대로 남았다 — 원자적 증감 연산은 메모리에 실제로 보이는 부수효과를 갖는다고 컴파일러가 취급하므로, 최적화가 지울 수 있는 대상이 아니다. `unique_ptr`의 "제로 오버헤드"는 문자 그대로 최적화가 흔적조차 안 남길 만큼 진짜라는 뜻이고, `shared_ptr`의 원자 연산 비용은 최적화 레벨을 올려도 못 없앤다는 뜻이다. `sink`가 두 버전 모두 같은 값을 찍은 것으로 계산 결과 자체는 두 루프 모두 정확히 수행됐음을 확인했다.
:::

`unique_ptr`가 [2.9의 interview 상자](#/unique-ptr)에서 이미 확인했듯 참조 카운트도 원자 연산도 없는 게 기본값이어야 하는 이유가 이 실측으로 다시 증명된다. **이 책 전체의 원칙은 하나다 — 소유자가 정말 둘 이상이어야 한다는 근거를 댈 수 있을 때만 `shared_ptr`로 올라가고, 그렇지 않으면 `unique_ptr`로 충분하다.**

## 로봇 도메인: rclcpp가 노드를 SharedPtr로 돌려주는 이유

`rclcpp`의 `rclcpp::Node::SharedPtr`, `rclcpp::Publisher<T>::SharedPtr`가 전부 `unique_ptr`가 아니라 `shared_ptr` 별칭인 데는 이 절의 논리가 그대로 적용된다. 퍼블리셔 하나를 만든 콜백 함수는 등록만 하고 곧 반환하지만, 실제로 그 퍼블리셔를 계속 쓰는 건 executor가 나중에 부르는 콜백들이다 — **몇 개의 콜백이 이 퍼블리셔를 캡처해 들고 있을지, 그중 마지막이 언제 실행을 끝낼지 컴파일 타임에 알 수 없다.** 정확히 이 절 첫머리의 센서 콜백 예제와 같은 모양이다. `shared_ptr`의 참조 카운트가 "지금 이 퍼블리셔를 쓰겠다고 등록된 콜백이 몇 개 남았는가"를 실행 중에 세어 주고, 마지막 콜백이 캡처를 놓는 순간 실제로 해제된다. [10.1 rclcpp 노드의 해부학](#/rclcpp-node)에서 이 소유권 구조를 노드 생명주기 전체 관점에서 다시 본다.

::: interview shared_ptr와 unique_ptr, 언제 무엇을 쓰나 / 순환 참조는 어떻게 막나
**소유자가 하나인가 여럿인가**로 가른다. 함수가 객체를 만들어 다른 곳에 소유권을 넘기기만 한다면(팩토리, 로컬 자원) `unique_ptr`다. 여러 곳이 동시에, 컴파일 타임에 정해지지 않은 순서로 소유해야 한다는 근거를 댈 수 있을 때만(콜백 캡처, 캐시, 관찰자 패턴) `shared_ptr`로 올린다 — "혹시 몰라서" 습관적으로 쓰면 이 절에서 실측한 원자 연산 비용을 모든 소유자가 매번 치른다.

순환 참조는 소유 관계에 **방향**을 만들어서 막는다 — 부모가 자식을 `shared_ptr`로 소유한다면, 자식은 부모를 절대 `shared_ptr`로 되잡지 않고 `weak_ptr`로 관찰만 한다. 설계 시점에 "누가 누구를 소유하는가"라는 트리 구조(또는 DAG)를 먼저 그리고, 그 방향을 거스르는 포인터가 하나라도 있으면 전부 `weak_ptr`로 내린다. 실행 중에 `use_count()`가 예상보다 안 줄어드는 것을 보고 나서야 순환을 의심하는 것보다, 설계 단계에서 방향을 정하는 게 먼저다.
:::

## 요약

- `unique_ptr`는 소유자가 여럿이어야 하는 요구를 표현할 수 없다 — 강제로 우회하면(두 번째 `std::move`) 컴파일은 통과해도 런타임에 `nullptr` 역참조로 죽는다(실측).
- `shared_ptr`는 힙에 별도로 만드는 **제어 블록**에 강한 참조 수(`use_count()`)와 약한 참조 수를 들고, 복사·소멸마다 그 수를 증감한다 — `sizeof(shared_ptr<T>)`는 `sizeof(T*)`의 두 배(포인터 + 제어 블록 포인터)다(실측).
- `make_shared<T>()`는 객체와 제어 블록을 한 번의 할당으로 합친다 — `shared_ptr<T>(new T())`보다 힙 할당이 절반이다(실측). 커스텀 딜리터가 필요하면 `make_shared`를 못 쓴다.
- 부모-자식이 서로를 `shared_ptr`로 소유하면 각자의 카운트가 절대 0에 도달하지 못해 소멸자가 영원히 안 불린다 — `LeakSanitizer`가 이걸 `Indirect leak`으로 정확히 잡는다(실측). 이게 shared_ptr의 진짜 함정이다.
- `weak_ptr`는 제어 블록의 약한 카운트만 올릴 뿐 강한 카운트(`use_count()`)에는 손대지 않는다 — 역방향 소유 관계를 `weak_ptr`로 바꾸면 순환이 끊겨 정상 소멸한다(실측). 접근은 반드시 `lock()`으로, 실패하면 원본이 이미 소멸했다는 뜻이다(`expired()`).
- 원자적 참조 카운트 증감은 최적화로도 지워지지 않는 실제 비용이다 — `unique_ptr`는 -O2에서 컴파일러가 힙 할당 자체를 통째로 제거할 만큼 오버헤드가 없지만, `shared_ptr`의 카운트 연산은 같은 최적화 레벨에서도 그대로 남는다(실측). 소유자가 정말 둘 이상이어야 할 근거가 있을 때만 `shared_ptr`를 쓴다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·ASan으로 확인하는 실습이다.

1. `shared_ptr<int>`의 `sizeof`가 `unique_ptr<int>`의 두 배인 이유를 제어 블록의 역할과 함께 설명하라. `weak_ptr<int>`의 `sizeof`가 `shared_ptr<int>`와 같은 이유는 무엇인가.

2. `make_shared<T>()`가 `shared_ptr<T>(new T())`보다 힙 할당 횟수가 적은 이유를 설명하고, `make_shared`를 쓸 수 없는 경우를 하나 들어라.

3. (실습, 코드 작성형) 이 절의 `sptr_cycle_leak.cpp`처럼 `Parent`/`Child`가 서로를 `shared_ptr`로 소유하는 코드를 직접 짜고 `-fsanitize=address`로 빌드해 LeakSanitizer가 누수를 잡는지 확인하라. 성공 기준: `Indirect leak`이 두 건 이상 찍히고 종료 코드가 0이 아니다.

4. (실습, 코드 작성형) 3번의 `Child`에서 `parent` 멤버를 `weak_ptr<Parent>`로 바꿔 다시 빌드하고 실행하라. 성공 기준: `~Parent`, `~Child` 소멸자 로그가 둘 다 찍히고, 같은 빌드 플래그에서 ASan/LSan 리포트가 전혀 없다(종료 코드 0).

5. (개념) 이 절의 -O2 벤치마크에서 `unique_ptr` 루프는 0us로 측정됐는데 `shared_ptr` 루프는 13.86ns/회가 그대로 남았다. 이 차이가 나는 이유를 컴파일러 최적화 관점에서 설명하라.
:::

::: answer 해설
1. 제어 블록은 강한 참조 수와 약한 참조 수, 딜리터를 담는 별도의 힙 블록이다. `shared_ptr`는 이 제어 블록을 가리키는 포인터를 자신이 가리키는 객체 포인터와 별개로 하나 더 들고 있어야 하므로 원시 포인터의 두 배(16바이트)가 된다. `weak_ptr`도 정확히 같은 두 포인터(객체 포인터, 제어 블록 포인터)를 들고 있다 — 다만 그 제어 블록의 강한 카운트를 올리지 않을 뿐이라 구조체 자체의 크기는 `shared_ptr`와 같다.
2. `shared_ptr<T>(new T())`는 `new T()`로 객체용 블록 한 번, `shared_ptr` 생성자 내부에서 제어 블록용 블록 한 번, 총 두 번 할당한다. `make_shared<T>()`는 객체와 제어 블록을 이어 붙인 하나의 블록을 한 번에 할당해 절반으로 줄인다. 커스텀 딜리터가 필요한 경우(`FILE*`처럼 `delete`가 아닌 정리가 필요할 때)는 `make_shared`가 딜리터 인자를 받지 않으므로 `shared_ptr<T>(new T(), deleter)` 형태로 직접 만들어야 한다.
3. `Parent`가 `shared_ptr<Child> child`를, `Child`가 `shared_ptr<Parent> parent`를 서로 들고 각각 `make_shared`로 만든 뒤 서로를 대입하면 된다. 지역 변수가 스코프를 벗어나도 서로의 카운트가 1씩만 내려가 0에 도달하지 못하므로, `-fsanitize=address`로 빌드하면 `Indirect leak of N byte(s)`가 두 객체 모두에 대해 찍히고 종료 코드가 1이다.
4. `Child`의 멤버를 `std::weak_ptr<Parent> parent`로 바꾸면, `Parent`의 카운트에서 `Child`가 쥔 몫이 빠져 `main`의 지역변수가 스코프를 벗어날 때 `Parent`부터(선언 역순 소멸 중 마지막으로 카운트가 0이 되는 쪽) 정상 소멸하고, `Parent`의 멤버 `child`가 소멸하며 연쇄적으로 `Child`도 소멸한다. 두 소멸자 로그가 모두 찍히고 ASan/LSan은 조용하다.
5. GCC는 -O2에서 `unique_ptr`의 `new`/`delete` 쌍이 루프 밖으로 전혀 관찰되지 않는다는 것을 증명할 수 있으면 그 할당 자체를 통째로 제거한다 — 오버라이드하지 않은 대체 가능한 전역 `operator new`/`delete`이기 때문에 이 소거가 허용된다. `shared_ptr`의 참조 카운트 증감은 원자적 연산이라 컴파일러가 실제 메모리에 보이는 부수효과로 취급하므로, 결과가 안 쓰이는 것처럼 보여도 최적화가 지울 수 없다. 그래서 `unique_ptr` 루프만 0us로 사라지고 `shared_ptr` 루프의 비용은 최적화 레벨을 올려도 그대로 남는다.
:::

이 절의 코드는 전부 직접 쳐라. `sptr_cycle_leak.cpp`와 `sptr_cycle_fixed.cpp`는 나란히 두고 `-fsanitize=address` 빌드로 둘 다 돌려서 어느 쪽에서 `Indirect leak`이 찍히는지, 어느 쪽에서 소멸자 로그가 둘 다 찍히는지 눈으로 봐라. `sptr_perf.cpp`는 `-O0`과 `-O2` 두 번 빌드해서 `unique_ptr` 루프의 시간이 어떻게 바뀌는지 직접 재 봐라. 전체 실습은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`으로 돌린다.

**다음 절**: [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers) — `shared_ptr`도 `unique_ptr`도 못 막는 진짜 미정의 동작을 정면으로 다루고, ASan/UBSan이 그걸 어떻게 잡아내는지 실측한다.
