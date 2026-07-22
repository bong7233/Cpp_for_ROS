# 2.8 Rule of 0/3/5

::: lead
[2.6 복사 시맨틱](#/copy-semantics)에서 `Buffer`에 깊은 복사를 직접 써서 이중 해제를 고쳤고, [2.7 이동 시맨틱과 rvalue 레퍼런스](#/move-semantics)에서 이동 생성자를 얹어 낭비되는 복사를 없앴다. 완성된 것처럼 보이지만, 이동 생성자를 추가하는 순간 잘 동작하던 복사가 조용히 무너진다 — 정확히는 컴파일조차 안 된다. 소멸자·복사 생성자·복사 대입·이동 생성자·이동 대입, 이 다섯 개의 특수 멤버 함수는 독립된 스위치가 아니라 서로 얽힌 하나의 시스템이다. 하나를 건드리면 나머지가 자동으로 반응한다 — 어떤 건 조용히 사라지고, 어떤 건 삭제된다. 이 절은 그 반응 규칙을 표로 정리하고, "언제 다섯 개를 다 써야 하는가", "언제 아무것도 안 써도 되는가"를 가른다.
:::

## 이동 생성자 하나가 조용히 복사 생성자를 지운다

[2.7](#/move-semantics)에서 배운 대로 `Buffer`에 이동 생성자를 추가한다고 하자. 소멸자만 있던 상태에서 복사 생성자는 아직 안 쓴 채로 이동 생성자만 얹어 본다.

```cpp title="hook_move_breaks_copy.cpp — 이동 생성자만 추가했다"
#include <iostream>

class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) {
        for (std::size_t i = 0; i < n; ++i) data_[i] = static_cast<int>(i);
    }
    ~Buffer() { delete[] data_; }

    // 2.7에서 배운 이동 생성자를 추가했다 -- 복사 생성자·복사 대입은 손대지 않았다
    Buffer(Buffer&& other) noexcept : size_(other.size_), data_(other.data_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }

    std::size_t size_;
    int* data_;
};

int main() {
    Buffer a(5);
    Buffer b = a;   // 복사 -- 2.6에서는 이 줄이 (위험하지만) 컴파일은 됐다
    std::cout << b.data_[0] << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra hook_move_breaks_copy.cpp -o hook_move_breaks_copy
hook_move_breaks_copy.cpp: In function 'int main()':
hook_move_breaks_copy.cpp:22:16: error: use of deleted function 'constexpr Buffer::Buffer(const Buffer&)'
   22 |     Buffer b = a;   // 복사 -- 2.6에서는 이 줄이 (위험하지만) 컴파일은 됐다
      |                ^
hook_move_breaks_copy.cpp:3:7: note: 'constexpr Buffer::Buffer(const Buffer&)' is implicitly declared as deleted because 'Buffer' declares a move constructor or move assignment operator
    3 | class Buffer {
      |       ^~~~~~
```

`Buffer b = a;`는 [2.6](#/copy-semantics)에서 위험하긴 해도 멀쩡히 컴파일됐던 줄이다. 여기서는 아예 빌드가 안 된다. 에러 메시지가 이유를 정확히 말해 준다 — **복사 생성자가 삭제된 상태로 선언됐다.** "안 만들어졌다"가 아니라 "만들어지긴 했는데 삭제됐다"는 표현에 주의해라 — 이동 생성자나 이동 대입 연산자를 하나라도 직접 선언하면, 컴파일러는 복사 생성자·복사 대입 연산자를 `= delete`가 붙은 상태로 선언해 둔다. 그래서 "그런 함수가 없다"는 애매한 에러가 아니라 "그 함수는 삭제됐다"는 명확한 에러가 뜬다.

::: danger 다섯 개가 서로의 존재를 감시한다
**하나를 직접 쓰는 순간 나머지 네 개의 자동 생성 여부가 통째로 바뀐다.** 어떤 조합은 "생성 안 됨"(조용히 대체), 어떤 조합은 "삭제됨"(컴파일 에러). 다음부터 표로 정리한다.
:::

## 다섯 개의 특수 멤버 함수와 자동 생성 규칙

**특수 멤버 함수**(special member function)는 컴파일러가 조건에 따라 만들어 주는 다섯 개의 함수다 — 소멸자, 복사 생성자, 복사 대입, 이동 생성자, 이동 대입. 기본 생성자도 여섯 번째로 묶이지만([1.8](#/structs-enums)), 소유권·수명 관리와 직접 관련된 이 다섯 개만 본다.

규칙은 표로 정리된다.

| 직접 쓴 것 | 이동 생성자·대입 | 복사 생성자·대입 |
| --- | --- | --- |
| 아무것도 안 씀 | 자동 생성(멤버별 이동) | 자동 생성(멤버별 복사) |
| 소멸자만 | **생성 안 됨** — 조용히 복사로 대체 | 자동 생성(deprecated 경고) |
| 복사 생성자 또는 대입 | **생성 안 됨** — 조용히 복사로 대체 | 쓴 것은 유지, 안 쓴 것은 자동 생성(경고) |
| 이동 생성자 또는 대입 | 쓴 것은 유지, 안 쓴 것은 **생성 안 됨** | **삭제됨(`= delete`)** — 컴파일 에러 |

**멤버별 이동**(memberwise move)은 멤버별 복사와 대칭이다 — 각 멤버를 그 타입의 이동 방법으로 하나씩 옮긴다. `int`처럼 이동 개념이 없는 타입은 그냥 복사되고, `std::string`·`std::vector`처럼 스스로 이동 생성자를 구현한 멤버는 그 이동이 불린다. 이 표를 네 가지 실측으로 검증한다.

### 사례 1: 소멸자만 쓰면 이동이 사라진다

[2.6](#/copy-semantics)의 `shallow_copy.cpp`처럼 소멸자만 쓴 `Buffer`에 `std::move`를 붙여 본다.

```cpp title="destructor_only_fallback.cpp — 소멸자만 직접 썼다"
#include <iostream>
#include <type_traits>
#include <utility>

class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) {
        for (std::size_t i = 0; i < n; ++i) data_[i] = static_cast<int>(i);
    }
    ~Buffer() { delete[] data_; }   // 소멸자만 직접 썼다 -- 복사/이동은 아무것도 안 썼다

    std::size_t size_;
    int* data_;
};

static_assert(std::is_copy_constructible_v<Buffer>,
              "소멸자만 써도 복사 생성자는 여전히 암묵적으로 만들어진다");
static_assert(std::is_move_constructible_v<Buffer>,
              "is_move_constructible은 '이동처럼 보이는 호출이 컴파일되는가'만 본다");

int main() {
    Buffer a(5);
    std::cout << "a.data_ = " << a.data_ << "\n";
    Buffer b = std::move(a);   // std::move를 붙였다 -- '진짜' 이동을 기대한다
    std::cout << "b.data_ = " << b.data_ << "  (a.data_와 같은가?)\n";
    std::cout << "a.data_ = " << a.data_ << "  (이동했으면 nullptr이어야 하는데?)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address destructor_only_fallback.cpp -o destructor_only_fallback
$ ./destructor_only_fallback
a.data_ = 0x503000000040
b.data_ = 0x503000000040  (a.data_와 같은가?)
a.data_ = 0x503000000040  (이동했으면 nullptr이어야 하는데?)
==32474==ERROR: AddressSanitizer: attempting double-free on 0x503000000040 in thread T0:
    #0 ... in operator delete[](void*)
    #1 ... in Buffer::~Buffer() destructor_only_fallback.cpp:10
    #2 ... in main destructor_only_fallback.cpp:29
SUMMARY: AddressSanitizer: double-free
```

`static_assert(std::is_move_constructible_v<Buffer>)`는 **통과했다.** 그런데 `std::move(a)` 이후에도 `a.data_`는 `nullptr`이 안 됐고 `b.data_`와 완전히 같은 주소다 — [2.6](#/copy-semantics)의 멤버별 복사(얕은 복사)가 다시 일어났을 뿐이다. `is_move_constructible_v`가 참인 이유는 rvalue를 `const Buffer&`에 묶어 복사 생성자를 호출하는 경로가 성립해서다 — "이동처럼 보이는 호출이 컴파일되는가"만 검사하지, 실제로 옮기는지는 검사하지 않는다.

### 사례 2: 복사만 쓰면 이동은 '조용히' 복사로 대체된다

[2.6](#/copy-semantics)의 `deep_copy.cpp`처럼 복사만 쓰고 이동은 안 쓴 `Buffer`에 복사 횟수 카운터를 심고 `std::move`를 걸어 본다.

```cpp title="copy_only_fallback_move.cpp — 깊은 복사는 완성했지만 이동은 안 썼다"
#include <chrono>
#include <cstring>
#include <iostream>
#include <type_traits>

class Buffer {
public:
    static inline int copy_count = 0;

    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) { /* 값 채우기 생략 */ }
    Buffer(const Buffer& other) : size_(other.size_), data_(new int[other.size_]) {
        std::memcpy(data_, other.data_, size_ * sizeof(int));
        ++copy_count;
    }
    Buffer& operator=(const Buffer& other) {   // 2.6의 deep_copy.cpp와 동일한 깊은 대입
        if (this == &other) return *this;
        int* new_data = new int[other.size_];
        std::memcpy(new_data, other.data_, other.size_ * sizeof(int));
        delete[] data_;
        data_ = new_data;
        size_ = other.size_;
        return *this;
    }
    ~Buffer() { delete[] data_; }
    // 이동 생성자·이동 대입은 아무것도 안 썼다

    std::size_t size_;
    int* data_;
};

static_assert(std::is_move_constructible_v<Buffer>,
              "이동 생성자를 안 썼는데도 true다 -- 복사 생성자로 대체되기 때문");

int main() {
    constexpr std::size_t N = 10'000'000;   // 약 38MB
    Buffer a(N);
    auto t0 = std::chrono::steady_clock::now();
    Buffer b = std::move(a);   // std::move를 붙였지만 이동 생성자가 없다
    auto t1 = std::chrono::steady_clock::now();
    std::cout << "std::move(a) 이후 copy_count = " << Buffer::copy_count << "\n";
    std::cout << "'이동'에 걸린 시간 = "
              << std::chrono::duration<double, std::milli>(t1 - t0).count() << " ms\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 copy_only_fallback_move.cpp -o copy_only_fallback_move
$ ./copy_only_fallback_move
std::move(a) 이후 copy_count = 1
'이동'에 걸린 시간 = 12.7878 ms  (진짜 이동이면 수 마이크로초 이내여야 한다)
```

(g++ 13.3 / `-O2` 실측. 절대 시간은 기기마다 다르지만 "38MB급 이동이 12ms대"라는 것 자체가 증거다.) `copy_count`가 `1` 늘었다 — 오버로드 해석이 고른 건 이동 생성자가 아니라 **복사 생성자**다. `std::move`는 캐스트일 뿐 아무 동작도 강제하지 않는다는 것을 [2.7](#/move-semantics)에서 봤는데, 그 대가가 여기서 숫자로 드러난다.

### 사례 3: 이동을 쓰면 복사가 삭제된다

이 절 서두의 `hook_move_breaks_copy.cpp`가 이미 이 사례다. 한 걸음 더 들어가, 이동 생성자만 쓰고 이동 대입은 안 쓴 경우를 확인한다.

```cpp title="move_only_no_assign.cpp — 이동 생성자만 쓰고 이동 대입은 안 썼다"
#include <utility>

class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) {}
    ~Buffer() { delete[] data_; }
    Buffer(Buffer&& other) noexcept : size_(other.size_), data_(other.data_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }
    std::size_t size_;
    int* data_;
};

int main() {
    Buffer a(5), b(3);
    b = std::move(a);   // 이동 대입을 안 썼다 -- operator=가 통째로 없는 게 아니라 삭제된 것 하나뿐
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra move_only_no_assign.cpp -o move_only_no_assign
move_only_no_assign.cpp:14:20: error: use of deleted function 'constexpr Buffer& Buffer::operator=(const Buffer&)'
   14 |     b = std::move(a);   // 이동 대입을 안 썼다
      |                    ^
move_only_no_assign.cpp:2:7: note: 'constexpr Buffer& Buffer::operator=(const Buffer&)' is implicitly declared as deleted because 'Buffer' declares a move constructor or move assignment operator
```

`b = std::move(a);`가 후보로 찾은 유일한 `operator=`는 복사 대입 연산자였고, 그건 규칙대로 **삭제된 상태**였다. 이동 대입 연산자는 애초에 후보에 있지도 않다 — 이동 생성자를 직접 썼기 때문에 자동 생성되지 않았다. 결과적으로 이 클래스는 **대입이라는 연산 자체가 완전히 막혀 있다** — 다섯 중 하나만 골라 쓰면 최소 하나의 연산은 통째로 깨진다.

### 사례 4: 소멸자를 가상으로 선언해도 마찬가지다

사례 1의 규칙은 `virtual ~T() = default;`처럼 몸체가 비어 있어도 적용된다. [3.4 가상함수와 vtable](#/virtual-vtable)의 다형 소멸자를 미리 당겨써서, 어떤 생성자가 실제로 불렸는지 증언하는 멤버로 확인한다.

```cpp title="virtual_dtor_blocks_move.cpp — 가상 소멸자만 선언했다"
#include <iostream>
#include <type_traits>
#include <utility>

// 어떤 생성자가 실제로 불렸는지 표준 출력으로 증언하게 만든 멤버
struct Tattle {
    Tattle() = default;
    Tattle(const Tattle&) { std::cout << "  Tattle: 복사 생성자 호출\n"; }
    Tattle(Tattle&&) noexcept { std::cout << "  Tattle: 이동 생성자 호출\n"; }
};

class LegController {
public:
    virtual ~LegController() = default;   // 몸체가 비어 있어도 '사용자 선언'이다
    virtual void step() {}
    Tattle log_;
};

static_assert(std::is_copy_constructible_v<LegController>);
static_assert(std::is_move_constructible_v<LegController>,
              "true다 -- 다만 '진짜 이동 생성자가 있다'는 뜻은 아니다");

int main() {
    LegController a;
    LegController b = std::move(a);   // 어느 쪽이 불리는지 Tattle이 알려준다
    (void)b;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra virtual_dtor_blocks_move.cpp -o virtual_dtor_blocks_move
$ ./virtual_dtor_blocks_move
  Tattle: 복사 생성자 호출
```

이동을 요청했는데 출력은 "이동 생성자 호출"이 아니라 **"복사 생성자 호출"**이다. `virtual ~LegController() = default;` 한 줄도 사용자 선언 소멸자로 카운트돼 사례 1과 같은 일이 벌어졌다. 다형 기반 클래스는 거의 항상 가상 소멸자를 선언하므로(파생 클래스의 안전한 소멸에 필요하다 — [3.4](#/virtual-vtable)), **다형 클래스 계층에서는 이동이 저절로 사라지는 게 기본값**이다.

::: deep "생성 안 됨"과 "삭제됨"은 다른 실패 모드다
사례 1·2·4는 이동 함수가 **선언조차 안 됐다** — `std::move`를 써도 조용히 복사로 새는 런타임 낭비다. 사례 3은 복사 함수가 **삭제된 상태로 선언됐다** — 시도하면 컴파일 에러가 뜬다. 실무에선 후자가 안전하다. 컴파일 실패는 바로 고치지만, 조용한 폴백은 프로파일링 전까지 아무도 모른다.
:::

## Rule of Zero: 아무것도 안 쓰지 않는 것이 제일 좋은 코드

지금까지의 사고는 `Buffer`가 원시 포인터로 힙 자원을 **직접** 쥐어서 벌어졌다. 멤버가 전부 스스로 소유권을 관리하는 타입이면 다섯 개 중 어느 것도 직접 쓸 필요가 없다.

```cpp title="rule_of_zero_sensorlog.cpp — 특수 멤버 함수를 5개 다 안 썼다"
#include <chrono>
#include <iostream>
#include <string>
#include <type_traits>
#include <vector>

class SensorLog {
public:
    explicit SensorLog(std::size_t n) : readings_(n, 0.0) {}

    std::vector<double> readings_;
    std::string frame_id_ = "lidar_front";
};

static_assert(std::is_copy_constructible_v<SensorLog>);
static_assert(std::is_move_constructible_v<SensorLog>);
static_assert(std::is_copy_assignable_v<SensorLog>);
static_assert(std::is_move_assignable_v<SensorLog>);

int main() {
    constexpr std::size_t N = 10'000'000;   // double 8바이트 x 1000만 = 약 76MB
    SensorLog a(N);

    auto t0 = std::chrono::steady_clock::now();
    SensorLog copy = a;               // vector가 직접 구현한 깊은 복사
    auto t1 = std::chrono::steady_clock::now();
    SensorLog moved = std::move(a);   // vector가 직접 구현한 진짜 이동
    auto t2 = std::chrono::steady_clock::now();

    std::cout << "복사 1회: " << std::chrono::duration<double, std::milli>(t1 - t0).count() << " ms\n";
    std::cout << "이동 1회: " << std::chrono::duration<double, std::milli>(t2 - t1).count() << " ms\n";
    std::cout << "이동 후 a.readings_.size() = " << a.readings_.size() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 rule_of_zero_sensorlog.cpp -o rule_of_zero_sensorlog
$ ./rule_of_zero_sensorlog
복사 1회: 31.1832 ms
이동 1회: 0.00023 ms
이동 후 a.readings_.size() = 0
```

(g++ 13.3 / `-O2` 실측. 반복 실행에서 복사는 28~560ms 사이로 흔들렸다 — 76MB 할당의 페이지 폴트 비용 때문이다. 이동은 매번 0.001ms 미만이었다.) `SensorLog`는 다섯 줄 중 하나도 안 썼는데 다섯 `static_assert`가 전부 통과하고, 복사는 진짜로 깊고 이동은 진짜로 빠르다 — 멤버가 `std::vector`·`std::string`뿐이라 그 타입들의 복사·이동 구현을 그대로 불러 쓴다.

::: tip 이 절 전체에서 가장 중요한 한 문장
**가장 좋은 코드는 이 다섯 개를 안 쓰는 코드다.** 원시 포인터·파일 디스크립터를 직접 들고 있지 말고 `std::vector`·`std::unique_ptr`·`std::shared_ptr`로 감싸라. Rule of Three/Five는 "원시 자원을 직접 쥐어야만 하는 예외"를 위한 것이지 기본값이 아니다.
:::

## Rule of Three: 자원을 쥐면 셋이 함께 다닌다 (구시대)

C++11 이전에는 이동 생성자·이동 대입 연산자라는 개념 자체가 없었다. 그 시절 자원을 직접 쥐는 클래스가 지켜야 할 규칙은 셋뿐이었다: **소멸자, 복사 생성자, 복사 대입 연산자 중 하나가 필요하면 셋 다 필요하다.** [2.6](#/copy-semantics)에서 "이 셋을 함께 쓰면 안전하다"는 결과는 봤다. 여기서는 **왜 셋이 묶이는지**를, 둘만 완성하고 하나를 빠뜨린 경우로 확인한다.

```cpp title="partial_three_broken_assign.cpp — 복사 생성자는 깊게, 복사 대입은 안 썼다"
#include <cstring>
#include <iostream>

class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) {
        for (std::size_t i = 0; i < n; ++i) data_[i] = static_cast<int>(i);
    }
    // 깊은 복사 생성자는 제대로 썼다
    Buffer(const Buffer& other) : size_(other.size_), data_(new int[other.size_]) {
        std::memcpy(data_, other.data_, size_ * sizeof(int));
    }
    ~Buffer() { delete[] data_; }
    // operator=는 안 썼다 -- 컴파일러가 알아서 맞게 채워 줄 거라 믿었다

    std::size_t size_;
    int* data_;
};

int main() {
    Buffer a(5);
    Buffer b(3);
    b = a;   // 대입 -- 복사 생성자가 아니라 암묵적 복사 대입 연산자가 불린다
    std::cout << "b.data_ = " << b.data_ << "  a.data_ = " << a.data_ << "\n";
    return 0;   // b, a 순서로 소멸 -- 같은 주소를 두 번 delete[]
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address partial_three_broken_assign.cpp -o partial_three_broken_assign
partial_three_broken_assign.cpp: In function 'int main()':
partial_three_broken_assign.cpp:25:9: warning: implicitly-declared 'constexpr Buffer& Buffer::operator=(const Buffer&)' is deprecated [-Wdeprecated-copy]
   25 |     b = a;
      |         ^
partial_three_broken_assign.cpp:10:5: note: because 'Buffer' has user-provided 'Buffer::Buffer(const Buffer&)'
$ ./partial_three_broken_assign
b.data_ = 0x503000000040  a.data_ = 0x503000000040
==2225==ERROR: AddressSanitizer: attempting double-free on 0x503000000040 in thread T0:
    #0 ... in operator delete[](void*)
    #1 ... in Buffer::~Buffer() partial_three_broken_assign.cpp:13
    #2 ... in main partial_three_broken_assign.cpp:29
SUMMARY: AddressSanitizer: double-free
```

컴파일러가 **경고로 미리 알려줬다.** `-Wdeprecated-copy`가 "복사 생성자는 직접 만들었는데 복사 대입은 암묵 생성에 맡겼다"는 비대칭을 짚는다. `b = a;`는 대입이므로 암묵적 복사 대입 연산자가 불렸고, 그건 여전히 멤버별 복사다 — 두 포인터가 같은 주소로 찍히고 스코프 종료 시 이중 해제가 재현된다. **복사 생성자를 손으로 고쳤다고 복사 대입까지 고쳐지지 않는다** — 하나만, 둘만 완성하면 나머지가 틀린 암묵 버전으로 남는다.

::: hist 왜 처음엔 셋이었나
C++98/03엔 이동이라는 연산 자체가 없었다. 함수 반환이나 컨테이너 재할당조차 유일한 수단은 복사였다([2.6](#/copy-semantics)의 `vector_copies.cpp`가 재할당마다 기존 원소를 전부 복사한 이유). C++11이 이동 시맨틱을 들여오며 이동 생성자·대입이 추가됐고, 규칙 이름도 "Three"에서 "Five"로 늘었다.
:::

## Rule of Five: 이동까지 포함한 다섯 (현대)

C++11 이후의 규칙은 다섯이다: **자원을 직접 소유하는 클래스는 다섯 개를 전부 올바르게 쓰거나, 복사·이동 자체를 `= delete`로 막아야 한다.** [2.6](#/copy-semantics)·[2.7](#/move-semantics)에서 따로 완성했던 깊은 복사와 진짜 이동을 한 클래스에 모아 마무리한다.

```cpp title="rule_of_five_complete.cpp — 다섯 개를 전부 올바르게 썼다"
#include <cstring>
#include <iostream>
#include <utility>

class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) { /* 채우기 생략 */ }

    // 1. 복사 생성자 -- 2.6
    Buffer(const Buffer& other) : size_(other.size_), data_(new int[other.size_]) {
        std::memcpy(data_, other.data_, size_ * sizeof(int));
    }
    // 2. 복사 대입 -- 2.6, 자기 대입 방어 포함
    Buffer& operator=(const Buffer& other) {
        if (this == &other) return *this;
        int* new_data = new int[other.size_];
        std::memcpy(new_data, other.data_, other.size_ * sizeof(int));
        delete[] data_;
        data_ = new_data;
        size_ = other.size_;
        return *this;
    }
    // 3. 이동 생성자 -- 2.7
    Buffer(Buffer&& other) noexcept : size_(other.size_), data_(other.data_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }
    // 4. 이동 대입 -- 2.7, 자기 대입 방어 포함
    Buffer& operator=(Buffer&& other) noexcept {
        if (this == &other) return *this;
        delete[] data_;
        data_ = other.data_;
        size_ = other.size_;
        other.data_ = nullptr;
        other.size_ = 0;
        return *this;
    }
    // 5. 소멸자
    ~Buffer() { delete[] data_; }

    std::size_t size_;
    int* data_;
};

int main() {
    Buffer a(5), c(5);
    Buffer b = a;                 // 복사
    int* moved_from = a.data_;
    Buffer d = std::move(a);      // 이동
    c = std::move(b);             // 이동 대입
    std::cout << "d.data_ == moved_from: " << (d.data_ == moved_from) << "\n";
    std::cout << "이동 후 a.data_: " << a.data_ << ", b.data_: " << b.data_ << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address rule_of_five_complete.cpp -o rule_of_five_complete
$ ./rule_of_five_complete
d.data_ == moved_from: 1
이동 후 a.data_: 0, b.data_: 0
$ echo $?
0
```

경고 없이 컴파일되고, ASan이 아무 리포트 없이 종료 코드 `0`으로 끝난다. `d.data_`가 이동 전 `a.data_`와 같은 주소(자원을 그대로 넘겨받았다)이고, 이동 후 `a`·`b`는 `nullptr`을 들고 있다 — [2.9 unique_ptr](#/unique-ptr)의 moved-from 상태 그대로다. 다섯 함수의 목적은 다르지만 불변식은 하나다 — **소멸자가 두 번 실행돼도, 대입 도중 예외가 나도, 자기 자신에게 대입해도 안전해야 한다.**

::: warn 다섯 개를 "일부만" 쓰는 건 아무것도 안 쓰는 것보다 위험하다
하나만 직접 쓰면 나머지가 "생성 안 됨"이나 "삭제됨"으로 조용히 바뀐다. 다섯 개를 전부 올바르게 쓰거나 Rule of Zero로 돌아가라. "소멸자만 써 놓고 나중에 채우겠다"는 계획은 그 사이 사례 1의 버그를 안고 간다.
:::

## =default와 =delete: 침묵보다 선언

지금까지 "아무것도 안 쓰면 자동 생성"과 "하나를 쓰면 나머지가 바뀐다"를 봤다. 그 중간 지대가 있다 — **컴파일러가 원래 만들어 줬을 동작을 그대로 원하되, 그 의도를 코드에 명시적으로 남기고 싶은 경우**다. `= default`가 그 문법이다.

사례 4로 돌아간다. 로깅을 위해 소멸자를 직접 써야 하는데 이동까지 잃고 싶지 않다면, 나머지 넷을 명시적으로 되살리면 된다.

```cpp title="default_restores_after_dtor.cpp — 소멸자는 직접 쓰되 나머지 넷을 명시적으로 되살린다"
#include <chrono>
#include <iostream>
#include <string>
#include <vector>

class SensorLog {
public:
    explicit SensorLog(std::size_t n) : readings_(n, 0.0) {
        std::cout << "SensorLog 생성 (원소 " << n << "개)\n";
    }
    ~SensorLog() { std::cout << "SensorLog 소멸\n"; }   // 로그를 남기려고 소멸자를 직접 썼다

    // 소멸자를 썼다는 이유만으로 이동이 사라지는 걸 원하지 않는다 -- 명시적으로 되살린다
    SensorLog(const SensorLog&) = default;
    SensorLog& operator=(const SensorLog&) = default;
    SensorLog(SensorLog&&) = default;
    SensorLog& operator=(SensorLog&&) = default;

    std::vector<double> readings_;
    std::string frame_id_ = "lidar_front";
};

int main() {
    SensorLog a(5'000'000);
    auto t0 = std::chrono::steady_clock::now();
    SensorLog b = std::move(a);
    auto t1 = std::chrono::steady_clock::now();
    std::cout << "이동 시간: " << std::chrono::duration<double, std::milli>(t1 - t0).count() << " ms\n";
    std::cout << "a.readings_.size() = " << a.readings_.size() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 default_restores_after_dtor.cpp -o default_restores_after_dtor
$ ./default_restores_after_dtor
SensorLog 생성 (원소 5000000개)
이동 시간: 0.00013 ms
a.readings_.size() = 0
SensorLog 소멸
SensorLog 소멸
```

이동 시간이 `0.00013ms`, 이동 후 크기가 `0`이다 — 소멸자를 썼는데도 진짜 이동이 살아 있다. `= default`는 "컴파일러가 원래 만들었을 구현을 정확히 써넣어라"는 뜻이다 — 최종 코드는 같지만 **"이 클래스는 이동 가능해야 한다"는 설계 의도가 소스에 남는다.** 침묵은 "신경 안 썼다"와 "의도적으로 기본 동작을 원한다"를 구분 못 하지만 `= default`는 후자임을 알려준다.

반대로 `= delete`는 "이 연산이 개념적으로 성립하지 않는다"는 선언이다. [2.6](#/copy-semantics)의 `no_copy.cpp`에서 복사를 막는 용도로 썼는데, 다음 로봇 도메인 예제가 이동까지 확장한다.

## 로봇 도메인: 복사하면 안 되는 하드웨어 핸들

시리얼 포트, 소켓, 뮤텍스처럼 **실제 하드웨어나 커널 자원 하나에 묶인 핸들**은 다섯 개를 전부 쓰는 쪽이 아니라 "복사를 통째로 막는" 쪽이 정답인 경우가 많다. 두 객체가 "같은 시리얼 포트"라는 게 무슨 뜻인지 정의할 방법이 없기 때문이다 — 대신 소유권 이전(이동)은 허용해서, `unique_ptr`과 같은 패턴으로 설계한다.

```cpp title="hardware_handle.cpp — 복사는 금지, 이동은 허용"
#include <iostream>
#include <type_traits>
#include <utility>

// 실제 시리얼 포트 fd를 열고 닫는 대신, 열림/닫힘을 로그로만 남겨
// 하드웨어 접근 없이도 소유권 이동을 확인할 수 있게 한다.
class HardwareHandle {
public:
    explicit HardwareHandle(int fake_fd) : fd_(fake_fd) {
        std::cout << "핸들 열림: fd=" << fd_ << "\n";
    }
    ~HardwareHandle() {
        if (fd_ >= 0) std::cout << "핸들 닫힘: fd=" << fd_ << "\n";
    }

    // 복사하면 "같은 하드웨어"가 두 객체 몫으로 존재하게 된다 -- 개념 자체가 성립하지 않는다
    HardwareHandle(const HardwareHandle&) = delete;
    HardwareHandle& operator=(const HardwareHandle&) = delete;

    // 소유권 이전은 허용한다 -- unique_ptr과 정확히 같은 패턴
    HardwareHandle(HardwareHandle&& other) noexcept : fd_(other.fd_) { other.fd_ = -1; }
    HardwareHandle& operator=(HardwareHandle&& other) noexcept {
        if (this == &other) return *this;
        if (fd_ >= 0) std::cout << "핸들 닫힘(대입 전 기존 자원): fd=" << fd_ << "\n";
        fd_ = other.fd_;
        other.fd_ = -1;
        return *this;
    }

    int fd_;
};

static_assert(!std::is_copy_constructible_v<HardwareHandle>);
static_assert(std::is_move_constructible_v<HardwareHandle>);

int main() {
    HardwareHandle leg_actuator(42);
    HardwareHandle owner = std::move(leg_actuator);   // 소유권만 이전, fd는 여전히 하나
    std::cout << "leg_actuator.fd_ = " << leg_actuator.fd_ << "\n";
    std::cout << "owner.fd_        = " << owner.fd_ << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address hardware_handle.cpp -o hardware_handle
$ ./hardware_handle
핸들 열림: fd=42
leg_actuator.fd_ = -1
owner.fd_        = 42
핸들 닫힘: fd=42
```

`fd=42`짜리 핸들은 정확히 한 번 열리고 한 번 닫힌다 — 복사가 없으니 "누가 진짜 주인인가"를 헷갈릴 여지가 없다. 표준 라이브러리도 같은 판단이다: `static_assert(!std::is_copy_constructible_v<std::mutex>)`가 실제로 통과한다 — [6.3 mutex와 락 가드](#/mutex)의 `std::mutex`는 복사를 `= delete`했다(스레드가 주소를 직접 참조할 수 있어 이동까지 막았다). `HardwareHandle`처럼 **복사는 막고 이동은 허용**하는 패턴은 [2.9 unique_ptr](#/unique-ptr)에서 표준 버전으로 다시 만나고, [10.9 ros2_control과 hardware_interface](#/ros2-control)의 실제 하드웨어 인터페이스가 정확히 이 모양이다.

::: interview Rule of Three/Five/Zero가 뭔가
답변 뼈대: ① **Rule of Three** — 소멸자·복사 생성자·복사 대입 중 하나가 필요하면(자원 직접 소유의 신호) 셋 다 써야 한다. 하나만 고치면 나머지는 틀린 멤버별 복사로 남는다. ② **Rule of Five** — 이동 생성자·대입까지 포함한 버전. 이동 관련 함수를 하나라도 선언하면 복사 생성자·대입은 자동으로 `= delete`된다는 것까지 알면 좋은 답이다. ③ **Rule of Zero**가 가장 중요한 실전 지침 — 자원을 `std::vector`·`std::unique_ptr`로 감싸면 다섯 개 중 아무것도 안 써도 된다. ④ 후속 질문 "소멸자만 선언하면?" — "이동이 자동 생성되지 않아 `std::move`를 써도 조용히 복사로 대체된다"(사례 1의 실측).
:::

## 요약

- 소멸자·복사 생성자·복사 대입·이동 생성자·이동 대입, 다섯 개의 **특수 멤버 함수**는 서로 얽혀 있다 — 하나를 직접 선언하면 나머지의 자동 생성 여부가 바뀐다.
- 소멸자 또는 복사 함수를 직접 쓰면 이동 함수는 **생성 안 됨**(조용히 복사로 대체) — `is_move_constructible_v`가 참이어도 실제로는 복사가 도는 것일 수 있다(실측: `copy_count` 증가, 38MB 복사에 12.7ms).
- 이동 함수를 직접 쓰면 복사 함수는 **삭제됨**(`= delete`, 컴파일 에러) — "안 만들어짐"과 "삭제됨"은 다른 실패 모드다.
- **Rule of Zero**: 멤버가 전부 `std::vector`·`std::string` 같은 자기 관리 타입이면 다섯 개 중 아무것도 안 써도 복사는 깊고 이동은 빠르다(실측: 76MB 기준 복사 약 30ms대, 이동 0.001ms 미만).
- **Rule of Three**(구시대)·**Rule of Five**(현대): 원시 자원을 쥐는 클래스는 관련 함수를 전부 완성하거나(`-Wdeprecated-copy`가 놓친 짝을 알려준다), 복사·이동을 `= delete`로 막는다.
- `= default`는 기본 구현을 명시적으로 되살려 설계 의도를 남긴다(소멸자를 쓴 뒤에도 이동을 되살릴 수 있다). `= delete`는 복사가 성립하지 않는 타입에 쓴다 — `std::mutex`가 실제로 이렇다.

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. `partial_three_broken_assign.cpp`의 `-Wdeprecated-copy` 경고는 무엇이 잘못됐다고 알려주는가? `b = a;`가 호출하는 함수(복사 생성자인가 대입 연산자인가)를 근거로 크래시 원인을 설명하라.
2. `is_move_constructible_v<LegController>`는 참이지만 실제로는 복사 생성자가 불렸다(`virtual_dtor_blocks_move.cpp`). 이 트레이트만으로 "진짜 이동 생성자가 있다"고 결론 낼 수 없는 이유를 한 문장으로 설명하라.
3. `HardwareHandle`에서 이동 대입 연산자를 지운다면 `owner = std::move(leg_actuator);`에서 어떤 컴파일 에러가 날지 예측하라. `move_only_no_assign.cpp`를 참고해 어떤 함수가 "삭제된 상태"로 잡히는지 먼저 써라.
4. (실습) 원시 포인터로 자원을 쥐는 클래스를 만들되 **소멸자만** 직접 써라. `is_copy_constructible_v`·`is_move_constructible_v`가 둘 다 참인 것을 확인한 뒤, `std::move`로 만든 "이동"이 실제로는 얕은 복사라는 것을 두 포인터 주소로 증명하라.
5. (실습) 4번 클래스에 `noexcept` 이동 생성자·이동 대입을 추가하고 `!is_copy_constructible_v<T>`가 참이 되는 것을 확인하라. 복사 생성자·복사 대입까지 채워 다섯 개를 완성하고, `-fsanitize=address`로 복사·이동·이동 대입을 섞어 실행해 리포트 없이 종료 코드 0이 나오는지 확인하라.
:::

::: answer 해설
1. 복사 생성자는 직접 만들었는데 복사 대입은 암묵 생성에 맡겨진 비대칭을 경고한다. `b = a;`는 기존 객체에 덮어쓰는 **대입**이라 암묵적 복사 대입 연산자가 호출되고, 그건 멤버별 복사다 — 두 포인터가 같은 주소를 가리켜 스코프 종료 시 이중 해제가 난다.
2. `is_move_constructible_v<T>`는 "rvalue로 초기화하는 표현식이 컴파일되는가"만 검사한다. 이동 생성자가 없어도 rvalue를 `const T&`에 바인딩해 복사 생성자를 호출하는 경로가 있으면 그 조건을 만족시킨다 — "이동 함수가 실재하는가"가 아니라 "이동처럼 보이는 초기화가 유효한가"를 답할 뿐이다.
3. 이동 생성자가 선언돼 있으므로 암묵적 복사 대입은 `= delete`된 채로 선언된다. 이동 대입을 지우면 `operator=` 후보는 그 삭제된 복사 대입 하나뿐이라 `error: use of deleted function ... operator=(const HardwareHandle&)`가 난다.
4. `destructor_only_fallback.cpp`를 새 이름으로 다시 쓰면 된다. static_assert는 통과하지만, 이동 실행 후 두 포인터를 출력하면 같은 주소가 찍힌다 — 호출된 건 암묵적 복사 생성자였다는 뜻이다.
5. 이동 함수를 추가하는 순간 `!is_copy_constructible_v<T>`가 참이 된다. 다섯 개를 채운 완성본은 `rule_of_five_complete.cpp`와 같은 구조가 되고, 복사·이동을 섞은 ASan 빌드는 리포트 없이 종료 코드 0으로 끝난다 — 자원이 한 곳에서만 소유되고 정확히 한 번만 해제되기 때문이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `hook_move_breaks_copy.cpp`는 에러 메시지의 `note:` 줄까지 읽고 "왜 삭제됐다고 하는지" 스스로 설명해 보고, `virtual_dtor_blocks_move.cpp`는 `Tattle`이 찍는 메시지가 "복사"인지 "이동"인지 직접 실행해서 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [2.9 unique_ptr: 독점 소유권](#/unique-ptr) — 이 절의 `HardwareHandle`은 표준 라이브러리가 이미 만들어 둔 패턴을 손으로 다시 짠 것이다. 매번 다섯 함수를 직접 쓰지 않고도 "복사 불가, 이동 가능, 소멸자가 자동 해제"를 통째로 얻는 방법이 `std::unique_ptr`이고, 다음 절이 그 내부 구현과 제로 비용 근거를 실측으로 확인한다.
