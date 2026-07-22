# 2.9 unique_ptr: 독점 소유권

::: lead
[2.4](#/dynamic-alloc)는 네 가지 사고를 실측으로 쌓았다 — 누수, `new[]`/`delete[]` 불일치, 이중 해제, use-after-free. 그리고 그 절 마지막 줄에서 이렇게 예고했다. "소유자가 하나뿐임을 컴파일러가 강제하므로 이중 해제도 불일치도 애초에 코드에 나타나지 않는다." 이 절이 그 약속을 갚는다. `std::unique_ptr`는 새 문법이 아니다 — [2.1](#/memory-model)에서 본 "스택 프레임이 걷히면 그 안의 것이 통째로 사라진다"는 그림과 [2.7](#/move-semantics)에서 본 "소유권은 복사가 아니라 이동한다"는 그림, 이 두 개를 포인터 하나에 그대로 얹은 것뿐이다. 얹고 나면 2.4의 네 사고가 전부 컴파일 타임에 막힌다 — 그 사실을 이번에도 실측으로 확인한다.
:::

## 2.4의 네 가지 사고를 다시 써 본다

[2.4](#/dynamic-alloc)의 `leak.cpp`는 `delete[]`를 잊고 함수를 빠져나가 32바이트가 샜다. 같은 일을 `unique_ptr`로 다시 짜 본다.

```cpp title="uptr_leak.cpp — delete[] 자체가 없다"
#include <memory>

void work() {
    auto buf = std::make_unique<int[]>(8);
    buf[0] = 1;
}   // buf의 소멸자가 여기서 delete[]를 자동으로 부른다

int main() {
    work();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address uptr_leak.cpp -o uptr_leak
$ ./uptr_leak
$ echo $?
0
```

(g++ 13.3 / Linux x86-64 실측.) 코드 어디에도 `delete[]`가 없다. 실수로 빠뜨린 게 아니라 **애초에 쓸 자리가 없다** — `buf`가 스코프를 벗어나는 순간 `unique_ptr`의 소멸자가 자동으로 `delete[]`를 부르기 때문이다. LeakSanitizer도 조용하다. 여기까지는 [2.5 RAII](#/raii)의 반복이다.

이중 해제는 더 근본적으로 막힌다. [2.4](#/dynamic-alloc)의 `doublefree.cpp`가 실행 시점에 `Aborted`로 죽었던 것과 달리, `unique_ptr`은 **실행조차 되지 못한다.**

```cpp title="uptr_copyfail.cpp — 복사 시도 자체가 컴파일 에러"
#include <memory>

int main() {
    std::unique_ptr<int> a = std::make_unique<int>(42);
    std::unique_ptr<int> b = a;   // 복사 시도
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g uptr_copyfail.cpp -o uptr_copyfail
uptr_copyfail.cpp:5:30: error: use of deleted function
    'std::unique_ptr<_Tp, _Dp>::unique_ptr(const std::unique_ptr<_Tp, _Dp>&)
    [with _Tp = int; _Dp = std::default_delete<int>]'
    5 |     std::unique_ptr<int> b = a;   // 복사 시도
      |                              ^
/usr/include/c++/13/bits/unique_ptr.h:522:7: note: declared here
  522 |       unique_ptr(const unique_ptr&) = delete;
      |       ^~~~~~~~~~
```

(g++ 13.3 실측.) 이 리포트에 valgrind도 ASan도 필요 없다 — `g++`가 5번째 줄에서 바로 멈춘다. `unique_ptr`의 복사 생성자는 라이브러리 헤더 522번째 줄에서 `= delete`로 선언돼 있다. **두 개의 소유자가 같은 힙 블록을 가리키는 상황 자체를 컴파일러가 만들지 못하게 막는다** — [2.4](#/dynamic-alloc)에서 이중 해제와 use-after-free가 전부 "같은 블록을 가리키는 포인터가 둘 이상"이라는 조건에서 태어났다는 것을 기억한다면, 그 조건 자체를 지운 것이다. `new[]`/`delete` 불일치는 5절에서 실측한다 — `unique_ptr<T[]>`는 타입 자체가 `delete[]`만 부르도록 갈라져 있다.

## unique_ptr는 얇은 포인터다 — 제로 비용의 실물

`unique_ptr`가 "안전한 포인터"라고 하면 뭔가 부가 정보를 더 들고 다닐 거라고 짐작하기 쉽다. 실측해 본다.

```cpp title="uptr_sizeof.cpp"
#include <cstdio>
#include <memory>

struct Point { double x, y; };

int main() {
    std::printf("sizeof(int*)                  = %zu\n", sizeof(int*));
    std::printf("sizeof(std::unique_ptr<int>)   = %zu\n", sizeof(std::unique_ptr<int>));
    std::printf("sizeof(Point*)                 = %zu\n", sizeof(Point*));
    std::printf("sizeof(std::unique_ptr<Point>) = %zu\n", sizeof(std::unique_ptr<Point>));

    auto p = std::make_unique<Point>(Point{1.0, 2.0});
    std::printf("p->x = %.1f, (*p).y = %.1f\n", p->x, (*p).y);

    Point* raw = p.get();   // 소유권 없이 빌려주기만 한다
    std::printf("raw->x = %.1f (raw는 소유자가 아니다)\n", raw->x);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g uptr_sizeof.cpp -o uptr_sizeof
$ ./uptr_sizeof
sizeof(int*)                  = 8
sizeof(std::unique_ptr<int>)   = 8
sizeof(Point*)                 = 8
sizeof(std::unique_ptr<Point>) = 8
p->x = 1.0, (*p).y = 2.0
raw->x = 1.0 (raw는 소유자가 아니다)
```

(g++ 13.3 실측.) 어떤 타입을 감싸든 `sizeof(unique_ptr<T>)`는 `sizeof(T*)`와 정확히 같다 — 8바이트, 원시 포인터 하나 크기 그대로다. 참조 카운트도, 락도, 여분의 부기 데이터도 없다. **컴파일 타임에 "소유자는 하나"라는 규칙만 강제할 뿐, 런타임에 아무것도 더 들고 다니지 않는다** — 이게 이 언어가 즐겨 쓰는 제로 오버헤드 원칙의 실물이다. `*p`와 `p->x`는 원시 포인터와 똑같이 쓰고, `p.get()`은 소유권을 넘기지 않고 원시 포인터만 빌려준다 — `raw`가 `p`보다 오래 살아남으면 그 순간 `raw`는 [2.2](#/pointers)에서 다룬 댕글링 포인터가 된다는 규칙은 변하지 않는다. `get()`은 "잠깐 원시 API에 넘겨줄 때"만 쓰고, 그 포인터를 어딘가에 저장해 두는 용도로는 쓰지 않는다.

## 소유권은 이동만 가능하다

앞에서 복사는 컴파일 에러로 막혔다. 그런데 함수가 `unique_ptr`를 만들어 반환하거나, 소유권을 다른 변수에 넘기는 일은 실무에서 매일 벌어진다. 그 통로가 이동이다.

```cpp title="uptr_move.cpp"
#include <cstdio>
#include <memory>
#include <utility>

int main() {
    std::unique_ptr<int> a = std::make_unique<int>(42);
    std::printf("이동 전: a.get() = %p, *a = %d\n", (void*)a.get(), *a);

    std::unique_ptr<int> b = std::move(a);   // 소유권 이전
    std::printf("이동 후: b.get() = %p, *b = %d\n", (void*)b.get(), *b);
    std::printf("이동 후: a.get() = %p\n", (void*)a.get());

    if (a == nullptr) {
        std::printf("a == nullptr : true\n");
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g uptr_move.cpp -o uptr_move
$ ./uptr_move
이동 전: a.get() = 0x55d3d19682b0, *a = 42
이동 후: b.get() = 0x55d3d19682b0, *b = 42
이동 후: a.get() = (nil)
a == nullptr : true
```

(g++ 13.3 / Linux x86-64 실측. 주소값은 ASLR 때문에 실행마다 다르지만, `b`가 `a`와 정확히 같은 주소를 물려받는다는 관계는 항상 성립한다.) **이 그림은 [2.7의 이동 위젯](#/move-semantics)에서 `std::string`을 놓고 이미 본 것과 정확히 같다.** 그 위젯의 "② 이동" 시나리오에서 `b`는 `a`의 `ptr`·`size`·`capacity` 세 값만 그대로 가져왔고, `a`는 이동 생성자가 `ptr = nullptr`, `size = 0`으로 정리해 moved-from 상태(회색)가 됐다. `unique_ptr<int>`는 그 그림을 필드 하나로 줄인 버전이다 — 옮길 값이 원시 포인터 하나뿐이라, 이동은 그 포인터 값 하나를 복사하고 원본을 `nullptr`로 정리하는 것으로 끝난다. 위 실측에서 `b.get()`이 이동 전 `a.get()`과 **같은 주소**를 찍었고, 그 직후 `a.get()`은 `(nil)`이 됐다 — 힙의 `int` 하나는 단 1바이트도 움직이지 않았다. `unique_ptr`의 이동은 항상 O(1)이다.

여기서 [2.7](#/move-semantics)의 사용자 정의 타입과 다른 점 하나를 짚어야 한다. 임의의 클래스가 이동된 뒤의 moved-from 상태는 표준이 "유효하지만 미지정"이라고만 보장한다 — 어떤 값이 남는지는 그 타입의 이동 생성자 구현에 달렸다. `unique_ptr`는 다르다. **표준 라이브러리가 명시적으로 보장한다 — 이동된 뒤의 `unique_ptr`는 반드시 `nullptr`이다.** `if (a == nullptr)`로 이동 여부를 확실하게 검사할 수 있는 이유다. 이동 후 `a`를 실수로 역참조해도 `nullptr` 역참조로 즉시 죽으므로, [2.4](#/dynamic-alloc)의 조용한 use-after-free보다 훨씬 시끄럽게 드러난다.

::: warn 복사 생성자가 없다는 것은 함수 인자·반환에도 그대로 적용된다
`unique_ptr`를 값으로 받는 함수(`void f(std::unique_ptr<int> p)`)에 변수를 그냥 넘기면 복사가 시도돼 컴파일이 깨진다 — `f(std::move(p))`라고 명시적으로 써야 한다. 함수가 `unique_ptr`를 값으로 반환하는 것은 문제없다 — 반환값은 [1.6](#/functions)의 반환값 최적화(RVO)나 암묵적 이동으로 처리되고, 사용자가 손으로 `move`를 쓸 필요가 없다.
:::

## make_unique: new를 직접 부르지 않는 이유

이 책은 `new`를 직접 호출하지 않는다 — `std::make_unique`만 쓴다. 이유를 실측으로 확인한다. 먼저 원시 포인터가 잠깐이라도 소유자 없이 떠 있는 코드를 짜 본다.

```cpp title="uptr_gap.cpp — new와 소유 사이의 틈"
#include <cstdio>
#include <memory>
#include <stdexcept>

struct Sensor {
    Sensor() { std::printf("[Sensor 생성]\n"); std::fflush(stdout); }
    ~Sensor() { std::printf("[Sensor 소멸]\n"); std::fflush(stdout); }
};

void init_bus() {
    std::printf("[init_bus] 실패\n");
    std::fflush(stdout);
    throw std::runtime_error("버스 초기화 실패");
}

void open_bad() {
    Sensor* raw = new Sensor();   // ❌ 아직 아무도 소유하지 않는 나체 포인터
    init_bus();                   // 여기서 예외가 나면 raw는 영원히 새어나간다
    std::unique_ptr<Sensor> s(raw);
}

int main() {
    try {
        open_bad();
    } catch (const std::exception& e) {
        std::printf("[catch] %s\n", e.what());
        std::fflush(stdout);
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address uptr_gap.cpp -o uptr_gap
$ ./uptr_gap
[Sensor 생성]
[init_bus] 실패
[catch] 버스 초기화 실패

=================================================================
==32111==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 1 byte(s) in 1 object(s) allocated from:
    #0 ... in operator new(unsigned long) ...
    #1 ... in open_bad() uptr_gap.cpp:17
    #2 ... in main uptr_gap.cpp:24

SUMMARY: AddressSanitizer: 1 byte(s) leaked in 1 allocation(s).
$ echo $?
1
```

(g++ 13.3 / Linux x86-64 실측.) `[Sensor 소멸]`이 한 줄도 안 찍혔다 — `new Sensor()`는 성공했는데(`[Sensor 생성]` 출력) 그다음 줄 `init_bus()`가 예외를 던져 `unique_ptr<Sensor> s(raw)`로 넘어가는 마지막 줄에 끝내 도달하지 못했다. `raw`는 지역 원시 포인터일 뿐 소멸자가 없으므로, 함수가 예외로 탈출하는 순간 그 값 자체가 통째로 사라진다 — 가리키던 `Sensor` 객체는 아무도 모르게 힙에 남는다. **문제는 "언젠가 unique_ptr로 감싸긴 했다"가 아니라, `new`가 성공한 시점과 `unique_ptr`가 그 포인터를 넘겨받는 시점 사이에 예외를 던질 수 있는 코드가 끼어 있었다는 것이다.** 이 틈에 무엇이 들어가든(로그 호출, 다른 자원 초기화, 검증 함수) 같은 사고가 난다.

`make_unique`는 이 틈을 원천적으로 없앤다.

```cpp title="uptr_fixed.cpp — 할당과 소유가 한 호출 안에서 끝난다"
#include <cstdio>
#include <memory>
#include <stdexcept>

struct Sensor {
    Sensor() { std::printf("[Sensor 생성]\n"); std::fflush(stdout); }
    ~Sensor() { std::printf("[Sensor 소멸]\n"); std::fflush(stdout); }
};

void init_bus() {
    std::printf("[init_bus] 실패\n");
    std::fflush(stdout);
    throw std::runtime_error("버스 초기화 실패");
}

void open_good() {
    auto s = std::make_unique<Sensor>();  // ✅ 할당 + 소유가 원자적
    init_bus();
}   // s가 스코프를 벗어나며 소멸자가 불린다 — init_bus가 던져도 마찬가지다

int main() {
    try {
        open_good();
    } catch (const std::exception& e) {
        std::printf("[catch] %s\n", e.what());
        std::fflush(stdout);
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address uptr_fixed.cpp -o uptr_fixed
$ ./uptr_fixed
[Sensor 생성]
[init_bus] 실패
[Sensor 소멸]
[catch] 버스 초기화 실패
$ echo $?
0
```

(g++ 13.3 실측.) 이번엔 `[Sensor 소멸]`이 `[catch]`보다 먼저 찍혔다 — `init_bus()`가 예외를 던지자 `open_good` 프레임이 되감기며 `s`의 소멸자가 곧바로 불린 것이다. `make_unique<Sensor>()` 한 줄 안에서 할당과 소유가 동시에 끝나기 때문에, 원시 포인터가 소유자 없이 떠 있는 순간 자체가 코드에 존재하지 않는다.

::: hist 오래된 함정 하나, 그리고 지금은 바뀐 것
C++11 초기에는 `f(std::unique_ptr<T>(new T), g())`처럼 두 인자 함수 호출에서 `new T`와 `g()`의 평가 순서가 정해지지 않아, `g()`가 감싸이기 전에 끼어들어 예외를 던지면 같은 사고가 났다. C++17은 이 순서를 못박아(한 인자의 평가 중간에 다른 인자가 끼어들 수 없다) 그 특정 형태는 이제 안 일어난다. 하지만 `uptr_gap.cpp`처럼 원시 포인터를 변수에 담아 다음 줄로 넘기는 형태는 지금도 똑같이 샌다 — `make_unique`가 막는 게 정확히 이 틈이다.
:::

이 책의 규칙은 하나다. **`new`를 직접 호출하지 않는다. 항상 `make_unique`를 쓴다.**

## 커스텀 딜리터: delete가 아닌 정리가 필요할 때

`unique_ptr`가 항상 `delete`를 부르는 것은 아니다. `FILE*`처럼 `delete`가 아니라 `fclose`로 닫아야 하는 자원도 감쌀 수 있다 — [2.5 RAII](#/raii)의 `FileGuard`가 손으로 하던 일을 `unique_ptr`에 위임하는 것이다.

```cpp title="uptr_filedeleter.cpp — fclose를 딜리터로"
#include <cstdio>
#include <memory>

struct FcloseDeleter {
    void operator()(FILE* fp) const {
        if (fp != nullptr) {
            std::printf("[딜리터] fclose 호출\n");
            std::fclose(fp);
        }
    }
};

int main() {
    std::unique_ptr<FILE, FcloseDeleter> fp(std::fopen("/etc/hostname", "r"));
    if (!fp) {
        std::printf("파일 열기 실패\n");
        return 1;
    }
    char buf[64];
    if (std::fgets(buf, sizeof(buf), fp.get()) != nullptr) {
        std::printf("읽은 줄: %s", buf);
    }
    return 0;
}   // fp가 스코프를 벗어나며 FcloseDeleter::operator()가 자동으로 불린다
```

```console
$ g++ -std=c++20 -Wall -Wextra -g uptr_filedeleter.cpp -o uptr_filedeleter
$ ./uptr_filedeleter
읽은 줄: vm
[딜리터] fclose 호출
```

(g++ 13.3 실측 — 실행 환경의 `/etc/hostname` 값이 그대로 찍힌다.) 딜리터는 `unique_ptr`의 **두 번째 템플릿 인자**로 들어간다 — `unique_ptr<T>`가 사실 `unique_ptr<T, std::default_delete<T>>`의 줄임말이었던 것이다. 딜리터 타입이 시그니처에 들어간다는 것은, 딜리터가 자리를 차지할 수도 있다는 뜻이다. 실측해 본다.

```cpp title="uptr_deleter_sizeof.cpp — 딜리터 종류에 따른 크기 차이"
#include <cstdio>
#include <cstdlib>
#include <memory>

void free_deleter(int* p) { std::free(p); }

int main() {
    using DefaultUP = std::unique_ptr<int>;                        // 기본 딜리터
    using FnPtrUP   = std::unique_ptr<int, void(*)(int*)>;         // 함수 포인터 딜리터
    auto lambda_deleter = [](int* p) { std::free(p); };            // 무캡처 람다 딜리터
    using LambdaUP  = std::unique_ptr<int, decltype(lambda_deleter)>;

    std::printf("sizeof(int*)                        = %zu\n", sizeof(int*));
    std::printf("sizeof(DefaultUP)  (기본 딜리터)      = %zu\n", sizeof(DefaultUP));
    std::printf("sizeof(FnPtrUP)    (함수 포인터 딜리터) = %zu\n", sizeof(FnPtrUP));
    std::printf("sizeof(LambdaUP)   (무캡처 람다 딜리터) = %zu\n", sizeof(LambdaUP));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g uptr_deleter_sizeof.cpp -o uptr_deleter_sizeof
$ ./uptr_deleter_sizeof
sizeof(int*)                        = 8
sizeof(DefaultUP)  (기본 딜리터)      = 8
sizeof(FnPtrUP)    (함수 포인터 딜리터) = 16
sizeof(LambdaUP)   (무캡처 람다 딜리터) = 8
```

(g++ 13.3 실측.) `default_delete`는 상태가 없는 빈 클래스라 `unique_ptr`에 얹혀도 크기가 늘지 않는다. **함수 포인터를 딜리터로 쓰면 그 포인터 자체가 8바이트를 차지해 전체가 16바이트로 뛴다** — 함수 포인터는 런타임에 어디로 뛸지 담아야 하는 값이기 때문이다. 그런데 무캡처 람다는 함수 포인터로 변환 가능한데도 `LambdaUP`가 8바이트 그대로다. 캡처가 없는 람다는 컴파일러가 만드는 클래스도 멤버가 없는 빈 타입이라, `unique_ptr`가 내부적으로 딜리터를 **빈 기반 클래스 최적화(Empty Base Optimization, EBO)** 로 접어 넣어 크기를 0으로 만들기 때문이다. 실전에서 커스텀 딜리터를 쓸 때는 이 차이가 선택 기준이 된다 — 상태가 필요 없다면 무캡처 람다나 함수 객체(`FcloseDeleter`처럼)를 쓰는 편이 `unique_ptr` 자체의 크기를 지킨다.

## 배열 특수화: unique_ptr<T[]>

이 절 첫머리의 `uptr_leak.cpp`가 이미 `std::make_unique<int[]>(8)`을 썼다. `unique_ptr<T[]>`는 `unique_ptr<T>`와 다른 특수화다 — 소멸자가 `delete`가 아니라 `delete[]`를 부르고, `*`/`->` 대신 `operator[]`로 인덱싱한다.

```cpp title="uptr_array.cpp"
#include <cstdio>
#include <memory>

struct Reading {
    int id;
    ~Reading() { std::printf("[~Reading] id=%d\n", id); std::fflush(stdout); }
};

int main() {
    auto scan = std::make_unique<Reading[]>(3);   // delete[]를 자동으로 쓴다
    for (int i = 0; i < 3; ++i) {
        scan[i].id = i;             // operator[]로 인덱싱한다
    }
    std::printf("scan[1].id = %d\n", scan[1].id);
    return 0;
}   // scan 소멸 시 delete[]가 불려 세 원소의 소멸자가 모두 호출된다
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address uptr_array.cpp -o uptr_array
$ ./uptr_array
scan[1].id = 1
[~Reading] id=2
[~Reading] id=1
[~Reading] id=0
```

(g++ 13.3 실측.) 세 원소의 소멸자가 인덱스 역순(2, 1, 0)으로 전부 불렸다 — [2.4](#/dynamic-alloc)의 `arrmismatch.cpp`가 `delete`(단일 버전)로 배열을 잘못 지워 첫 원소만 소멸시키고 죽었던 것과 대조된다. `unique_ptr<T[]>`는 타입 자체가 배열용으로 갈라져 있어 `delete[]`를 쓸지 `delete`를 쓸지 손으로 고를 여지가 없다.

## 팩토리 패턴 맛보기: unique_ptr<Base>를 반환한다

`unique_ptr`가 정말 힘을 발휘하는 자리 중 하나가 팩토리 함수다 — 어떤 구체 타입을 만들지는 함수 내부에 감추고, 호출자에게는 상위 타입의 `unique_ptr`만 돌려준다.

```cpp title="uptr_factory.cpp"
#include <cstdio>
#include <memory>
#include <string>

struct HardwareInterface {
    virtual ~HardwareInterface() { std::printf("[~HardwareInterface]\n"); }
};

struct ServoBus : HardwareInterface {
    std::string port;
    explicit ServoBus(std::string p) : port(std::move(p)) {
        std::printf("[ServoBus 생성] %s\n", port.c_str());
    }
    ~ServoBus() override { std::printf("[~ServoBus] %s\n", port.c_str()); }
};

std::unique_ptr<HardwareInterface> make_hardware(const std::string& kind) {
    if (kind == "servo") {
        return std::make_unique<ServoBus>("/dev/ttyUSB0");
    }
    return nullptr;
}

int main() {
    std::unique_ptr<HardwareInterface> hw = make_hardware("servo");
    std::printf("hw != nullptr : %s\n", hw ? "true" : "false");
    return 0;
}   // hw 소멸 시 ~ServoBus부터 정확히 호출된다
```

```console
$ g++ -std=c++20 -Wall -Wextra -g uptr_factory.cpp -o uptr_factory
$ ./uptr_factory
[ServoBus 생성] /dev/ttyUSB0
hw != nullptr : true
[~ServoBus] /dev/ttyUSB0
[~HardwareInterface]
```

(g++ 13.3 실측.) `main`은 `ServoBus`라는 이름을 한 번도 쓰지 않았다 — `unique_ptr<HardwareInterface>`만 들고 있는데도, 소멸 시 `~ServoBus`가 `~HardwareInterface`보다 먼저, 정확히 불렸다. 이 코드의 가상 함수는 `virtual ~HardwareInterface()` 딱 하나뿐이다. 이 한 줄이 없었다면 정적 타입(`HardwareInterface`)의 소멸자만 불려 `ServoBus`의 `port` 멤버는 제대로 정리되지 못한다 — 실제로 실측하면 ASan이 `new-delete-type-mismatch`(32바이트로 할당한 것을 1바이트로 착각해 해제)를 그 자리에서 잡는다. **소멸자 하나가 `virtual`이라는 이유만으로 왜 이렇게 다르게 동작하는지, 그 동적 디스패치의 구조(vtable)는 [3.4](#/virtual-vtable)의 몫이다.** 지금은 "`unique_ptr<Base>`로 다형 객체를 돌려주는 팩토리는 `Base`의 소멸자가 `virtual`이어야 한다"는 규칙만 기억해 둔다.

## 로봇 도메인: hardware_interface가 unique_ptr로 하드웨어를 소유한다

`ros2_control`의 `hardware_interface`는 방금 만든 `make_hardware` 팩토리와 뼈대가 같다. 컨트롤러 매니저는 실제로 어떤 하드웨어 드라이버(서보 버스, 시뮬레이션 스텁)를 로드하는지 컴파일 타임에 몰라도 된다 — 플러그인 로더가 구체 클래스를 만들어 `unique_ptr<hardware_interface::SystemInterface>` 하나로 넘겨주고, 컨트롤러 매니저는 그 상위 타입으로만 `read()`/`write()`를 호출한다. `unique_ptr`를 쓰는 이유도 이 절에서 실측한 그대로다 — 하드웨어는 정확히 하나의 소유자만 있어야 하고(두 경로가 같은 시리얼 포트를 각자 닫으면 [2.4](#/dynamic-alloc)의 이중 해제와 같은 사고가 난다), 소유권을 모듈 사이로 넘길 일에는 이동으로 충분하다. [6.9 스레드 아키텍처](#/thread-architecture)에서 이 객체를 실시간 스레드가 어떻게 다루는지 볼 때, "누가 소유하는가"는 이미 이 절이 답해 둔 것이다.

::: interview unique_ptr가 shared_ptr보다 좋은 기본 선택인 이유
`unique_ptr`는 이 절에서 실측했듯 `sizeof`가 원시 포인터와 같고 참조 카운트 증감 같은 런타임 비용이 없다 — 반면 [2.10 shared_ptr](#/shared-ptr)는 제어 블록과 원자적 카운트 연산 비용을 매 복사·소멸마다 치른다. 소유자가 정말 여럿이어야 하는 경우(캐시, 관찰자 패턴, 여러 스레드의 동시 참조)가 아니면 소유자는 하나로 충분하다. **실무 규칙**: 소유권을 넘길 뿐이라면 `unique_ptr`, 여러 곳이 동시에 소유해야 한다는 근거를 댈 수 있을 때만 `shared_ptr`로 올라간다 — 처음부터 `shared_ptr`를 습관적으로 쓰면 소유자가 하나인 곳에도 불필요한 원자 연산 비용이 붙는다.
:::

## 요약

- `std::unique_ptr`는 복사 생성자·복사 대입 연산자가 `= delete`로 막힌 이동 전용 스마트 포인터다 — 복사 시도는 런타임이 아니라 **컴파일 타임 에러**로 잡힌다(실측).
- `sizeof(unique_ptr<T>)`는 `sizeof(T*)`와 같다 — 참조 카운트도 락도 없는 제로 오버헤드 소유권이다(실측).
- 이동은 포인터 값 하나만 옮기고 원본을 `nullptr`로 정리하는 O(1) 연산이다 — [2.7의 이동 위젯](#/move-semantics)에서 `std::string`으로 본 것과 같은 그림이며, `unique_ptr`의 moved-from 상태는 항상 `nullptr`임을 표준이 보장한다(실측).
- 원시 포인터를 변수에 담아 뒀다가 나중에 `unique_ptr`로 감싸면 그 사이에 예외가 끼어들어 샐 수 있다 — `make_unique`는 할당과 소유를 한 호출로 묶어 이 틈을 없앤다(실측). 이 책은 `new`를 직접 호출하지 않고 `make_unique`만 쓴다.
- 커스텀 딜리터는 두 번째 템플릿 인자로 들어간다 — 상태가 있는 딜리터(함수 포인터)는 크기를 늘리지만, 무캡처 람다·빈 함수 객체는 EBO로 크기가 늘지 않는다(실측).
- `unique_ptr<T[]>`는 `delete[]`를 자동으로 쓰고 `operator[]`로 인덱싱한다 — `delete`/`delete[]`를 손으로 고를 필요가 없다(실측).
- `unique_ptr<Base>`를 반환하는 팩토리 함수는 `Base`의 소멸자가 `virtual`이어야 정확히 동작한다 — 그 동적 디스패치의 구조는 [3.4](#/virtual-vtable)에서 다룬다. `ros2_control`의 `hardware_interface`가 정확히 이 뼈대로 하드웨어를 소유한다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·ASan으로 확인하는 실습이다.

1. `std::unique_ptr<int> b = a;`가 컴파일조차 되지 않는 이유를 헤더 안 어떤 선언 때문인지 근거를 들어 설명하라. [2.4](#/dynamic-alloc)의 이중 해제와 어떤 관계인가.

2. `unique_ptr`가 이동된 뒤의 상태와, [2.7](#/move-semantics)에서 본 일반 사용자 타입이 이동된 뒤의 상태는 표준이 보장하는 정도가 다르다. 무엇이 다른가.

3. (실습, 코드 작성형) `unique_ptr<FILE, ...>`로 커스텀 딜리터를 직접 짜라 — 단, 존재하지 않는 경로("/no/such/file")를 열어서 `fopen`이 실패하는 경로도 함께 테스트한다. 성공 기준: 존재하는 파일·존재하지 않는 파일 두 경로 모두 크래시 없이 동작하고, `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address`로 빌드한 실행 파일이 어느 쪽 경로에서도 조용하다(ASan 리포트 없음).

4. (실습, 코드 작성형) 이 절의 `uptr_gap.cpp`와 같은 구조(원시 포인터로 `new` 한 뒤 다음 줄에서 예외를 던지는 함수 호출)를 직접 짜서 LeakSanitizer로 누수를 확인한 뒤, `make_unique`로 고친 버전을 옆에 만들어 두 버전을 나란히 실행하라. 성공 기준: 원래 버전은 `Direct leak`이 찍히고 종료 코드가 1, 고친 버전은 아무 리포트 없이 종료 코드가 0임을 확인했다.

5. (실습, 코드 작성형) `uptr_factory.cpp`를 그대로 치되 `HardwareInterface`의 소멸자에서 `virtual`을 빼고 다시 컴파일·실행하라. 성공 기준: `-fsanitize=address` 빌드가 런타임에 `new-delete-type-mismatch` 에러를 내는 것을 직접 봤다 — 그 리포트가 "몇 바이트로 할당된 것을 몇 바이트로 해제하려 했는가"를 정확히 뭐라고 말하는지 적어라.
:::

::: answer 해설
1. `std::unique_ptr`의 복사 생성자는 `<bits/unique_ptr.h>`에 `unique_ptr(const unique_ptr&) = delete;`로 선언돼 있다 — 컴파일러가 이 삭제된 함수를 호출하려는 시도를 발견하는 순간 에러를 낸다. [2.4](#/dynamic-alloc)의 이중 해제는 "같은 블록을 가리키는 포인터가 둘 이상"일 때 각자 소멸자에서 `delete`를 불러 생겼다 — 복사를 원천 봉쇄하면 애초에 그 블록을 가리키는 `unique_ptr`가 둘 생길 수 없으므로 이중 해제 자체가 코드에 등장할 수 없다.
2. 임의 사용자 타입은 표준이 이동 후 상태를 "유효하지만 미지정"으로만 규정한다 — 실제로 남는 값은 그 타입의 이동 생성자 구현에 달렸다. `unique_ptr`는 다르다. 표준 라이브러리가 이동 후 소스가 **항상 정확히 `nullptr`이 된다**는 것을 보장한다 — 그래서 `if (a == nullptr)`로 확실하게 검사할 수 있다.
3. `std::unique_ptr<FILE, FcloseDeleter> fp(std::fopen(path, "r"));` 형태로 짜고, `fp`가 `nullptr`인지 `if (!fp)`로 검사한 뒤 반환하면 된다 — `FcloseDeleter::operator()`가 이미 `fp != nullptr` 검사를 하므로, 실패한 경우(딜리터가 `nullptr`을 넘겨받는 경우) `fclose`를 부르지 않아 안전하다.
4. 원래 버전은 `new`로 할당한 뒤 다음 줄의 함수가 예외를 던지게 만들면, 그 예외 이전에 `unique_ptr`로 감싸는 줄에 도달하지 못해 `Direct leak of N byte(s)`가 찍히고 종료 코드가 1이다. `make_unique`로 고친 버전은 할당과 소유가 한 호출에서 끝나 예외가 나도 이미 소유된 객체의 소멸자가 스택 되감기 중에 불려, 리포트 없이 종료 코드 0이다.
5. `virtual`을 빼면 `ASan`이 `new-delete-type-mismatch`를 낸다 — 리포트는 "size of the allocated type: 32 bytes"(`ServoBus`, `std::string` 멤버를 포함해 32바이트로 할당됨)와 "size of the deallocated type: 1 bytes"(`HardwareInterface`, 멤버 없는 빈 구조체라 1바이트로 해제 시도됨)를 정확히 대비해서 보여준다 — 정적 타입만 보고 해제 크기를 결정했다는 증거다.
:::

이 절의 코드는 전부 직접 쳐라. `uptr_gap.cpp`와 `uptr_fixed.cpp`는 나란히 두고 `-fsanitize=address` 빌드로 둘 다 돌려서 `[Sensor 소멸]`이 찍히는지 안 찍히는지 눈으로 봐라. `uptr_deleter_sizeof.cpp`는 딜리터를 직접 하나 더 추가해(예: 캡처가 있는 람다) `sizeof`가 어떻게 바뀌는지 실험해 봐라. 전체 실습은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`으로 돌린다.

**다음 절**: [2.10 shared_ptr와 weak_ptr](#/shared-ptr) — 소유자가 정말 둘 이상이어야 할 때, 참조 카운트가 실제로 무엇을 대가로 치르는지, 그리고 카운트만으로는 못 막는 순환 참조를 실측한다.
