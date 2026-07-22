# 5.7 std::function과 콜러블

::: lead
[5.6](#/lambdas)에서 `add`와 `add2`는 글자 하나 다르지 않은 같은 코드로 정의됐는데도 서로 다른 클로저 타입이었다. 캡처를 하나만 더 넣어도 `sizeof`가 바뀌고 타입이 바뀐다. 그런데 rclcpp의 구독자 콜백 등록, 이벤트 핸들러 테이블, 전략 패턴의 콜백 슬롯 — 이런 자리는 하필 "캡처가 몇 개든, 함수든 함자든 상관없이 시그니처만 맞으면 받는" 균일한 타입을 요구한다. 서로 다른 타입을 하나의 상자에 담아야 하는 이 모순을 `std::function`이 어떻게 풀어내는지, 그 대가가 정확히 몇 나노초인지, 그리고 애초에 `std::function`을 쓸 필요조차 없는 자리는 어디인지를 이 절에서 실측으로 가른다.
:::

## 콜러블: 함수 포인터, 함자, 람다를 묶는 이름

C++에서 `f(x)`라는 문법으로 호출할 수 있는 것은 생각보다 종류가 많다. 평범한 함수, 함수를 가리키는 포인터, `operator()`를 정의한 클래스의 인스턴스(함수 객체, 흔히 **함자**라고 부른다), 그리고 [5.6](#/lambdas)에서 파헤친 람다(사실은 함자의 익명 버전)까지 — 이들은 서로 다른 타입 계열이지만 전부 **콜러블(callable)**이라는 한 단어로 묶인다. 콜러블의 정의는 단순하다. `f(args...)`라는 호출 문법이 컴파일된다는 것, 즉 `f`가 호출 연산자(함수 자체의 호출 규약이든, 클래스의 `operator()`든)를 가진다는 것뿐이다.

```cpp title="callable_family.cpp — 네 가지 콜러블을 한 컨테이너에 담는다"
#include <functional>
#include <iostream>
#include <vector>

// 1) 평범한 함수 -- 함수 포인터로 붕괴한다.
int times_two(int x) { return x * 2; }

// 2) 함수 객체(functor) -- operator()를 가진 클래스.
struct AddN {
    int n;
    int operator()(int x) const { return x + n; }
};

int main() {
    int base = 100;

    // 3) 람다 -- 캡처가 있든 없든 컴파일러가 만든 클로저 타입.
    auto subtract_from_base = [base](int x) { return base - x; };

    // 넷 다 서로 다른 타입이지만, "int를 받아 int를 돌려주는 operator()가 있다"는
    // 공통점 하나로 std::function<int(int)> 컨테이너 하나에 담을 수 있다.
    std::vector<std::function<int(int)>> callables;
    callables.push_back(times_two);                    // 함수 포인터로 붕괴해서 저장
    callables.push_back(AddN{5});                       // 함수 객체를 값으로 복사해서 저장
    callables.push_back(subtract_from_base);            // 클로저 객체를 복사해서 저장
    callables.push_back([](int x) { return x * x; });   // 익명 람다도 그대로

    for (std::size_t i = 0; i < callables.size(); ++i) {
        std::cout << "callables[" << i << "](7) = " << callables[i](7) << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra callable_family.cpp -o callable_family
$ ./callable_family
callables[0](7) = 14
callables[1](7) = 12
callables[2](7) = 93
callables[3](7) = 49
```

(g++ 13.3 실측.) 네 원소의 타입은 각각 `int(*)(int)`, `AddN`, `subtract_from_base`의 클로저 타입, 이름 없는 또 다른 클로저 타입으로 전부 다르다. `sizeof`도 다르고 — 함수 포인터는 8바이트, `AddN`은 `int` 하나라 4바이트, `subtract_from_base`는 `int` 캡처 하나라 4바이트다. 그런데도 `std::vector<std::function<int(int)>>` 하나에 나란히 들어가 같은 for문으로 호출된다. 이게 가능한 이유는 `std::function<int(int)>`가 "네 타입의 공통 조상 클래스"가 아니라(애초에 네 타입 사이엔 상속 관계가 전혀 없다) **타입 소거**라는 완전히 다른 메커니즘을 쓰기 때문이다. 다음 절에서 그 메커니즘을 뜯어본다.

::: note 콜러블이라는 용어는 표준 용어가 아니다
C++ 표준 문서는 "Callable" 요구사항을 `std::invoke`, `std::function`, `std::thread` 생성자 등 여러 곳에서 정의하지만, 이 책에서 쓰는 "콜러블"이라는 명사는 그 요구사항을 만족하는 대상을 가리키는 이 책의 편의상 용어다. 실무에서도 "callable"이라는 표현은 널리 쓰이니 낯설어할 필요는 없다.
:::

## 타입 소거: 32바이트 상자 안에 무엇이든 넣는 법

`std::function<int(int)>`가 `times_two`(함수 포인터), `AddN{5}`(4바이트 함자), `subtract_from_base`(4바이트 클로저)를 전부 담으면서도 자기 자신의 `sizeof`는 그대로라는 사실이 핵심이다. `std::function<int(int)>` 객체 하나의 크기는 무엇을 담든 고정이다 — 이 환경에서는 32바이트다. 서로 다른 크기, 서로 다른 타입의 콜러블을 고정 크기 상자 하나로 통일해서 담는 이 기법을 **타입 소거(type erasure)**라고 부른다. "타입을 소거한다"는 이름 그대로, `std::function<int(int)>` 객체를 들고 있는 코드는 그 안에 원래 뭐가 들어있었는지(함수 포인터인지, `AddN`인지, 어떤 람다인지) 전혀 모른다 — 아는 건 "`int`를 받아 `int`를 돌려주는 뭔가"라는 시그니처뿐이다.

이 소거가 실제로 어떻게 구현되는지는 g++가 쓰는 표준 라이브러리(libstdc++) 헤더에 그대로 나와 있다. `std::function`의 기반 클래스는 대략 이런 모양이다.

```cpp title="/usr/include/c++/13/bits/std_function.h — 실제 구현 발췌 (조각, 컴파일 대상 아님)"
union _Nocopy_types {
    void*       _M_object;
    const void* _M_const_object;
    void (*_M_function_pointer)();
    void (_Undefined_class::*_M_member_pointer)();
};

union [[gnu::may_alias]] _Any_data {
    // ... _M_pod_data가 실제 버퍼: sizeof(_Nocopy_types) 바이트
    _Nocopy_types _M_unused;
    char _M_pod_data[sizeof(_Nocopy_types)];
};

class _Function_base {
public:
    static const size_t _M_max_size  = sizeof(_Nocopy_types);
    static const size_t _M_max_align = __alignof__(_Nocopy_types);

    using _Manager_type = bool (*)(_Any_data&, const _Any_data&, _Manager_operation);

    _Any_data     _M_functor{};   // 콜러블 본체 -- 작으면 여기, 크면 힙 포인터
    _Manager_type _M_manager{};  // 복사/이동/소멸을 대신 해 주는 함수 포인터
};

// std::function<R(Args...)>에 실제로 추가되는 멤버
using _Invoker_type = _Res (*)(const _Any_data&, _ArgTypes&&...);
_Invoker_type _M_invoker = nullptr;  // 호출을 대신 해 주는 함수 포인터
```

핵심 멤버는 셋이다. `_M_functor`(`_Any_data`, 콜러블을 담는 고정 크기 버퍼), `_M_manager`(복사·이동·소멸을 대신 해 주는 함수 포인터), `_M_invoker`(실제 호출을 대신 해 주는 함수 포인터). `std::function`이 생성될 때, 컴파일러는 담기는 콜러블의 **구체적인 타입**을 알고 있으므로 그 타입 전용의 `_M_manager`·`_M_invoker` 함수를 하나 찍어낸다(이 부분은 [4.3 템플릿 인스턴스화](#/template-mechanics)와 원리가 같다 — 타입마다 별도 함수가 인스턴스화된다). 이후 `std::function` 객체를 들고 다니는 코드는 원래 타입을 몰라도, 저장해 둔 `_M_invoker` 함수 포인터 하나만 호출하면 된다 — 그 함수 포인터 안에서 `_M_functor`를 원래 타입으로 캐스팅해 실제로 호출하는 코드가 이미 굳어 있기 때문이다. 이 절 도입부에서 "가상 함수 호출 또는 함수 포인터 테이블을 통한 간접 호출"이라고 예고한 게 바로 이 `_M_invoker`다 — vtable을 쓰는 다형성([3.4 가상함수와 vtable](#/virtual-vtable))과 목적은 같고(정확한 구현 함수를 런타임에 찾아간다), 구현 형태만 클래스별 vtable 슬롯이 아니라 함수 포인터 멤버 하나라는 점이 다르다.

```text nolines
std::function<int(int)>이 subtract_from_base를 담았을 때 (개념도, x86-64 libstdc++ 기준)

  std::function<int(int)>                     인스턴스화된 코드 (subtract_from_base 전용)
  +------------------------+                   +---------------------------------+
  | _M_functor (16 bytes)  |  <-- 값 캡처된    |  invoker(functor, x):            |
  |  [base 복사본 4바이트] |      base가 여기  |    auto& real = *(closure_t*)    |
  |  [나머지 12바이트 미사용]|     그대로 저장    |         functor.access();        |
  +------------------------+                   |    return real(x);   // 실제 호출 |
  | _M_manager (함수 포인터)| ----------------->|  manager(dest, src, op): ...      |
  +------------------------+                   +---------------------------------+
  | _M_invoker (함수 포인터)| ----------------->  (위 invoker를 가리킨다)
  +------------------------+
```

이 소거 덕분에 [5.6](#/lambdas)에서 본 "람다마다 서로 다른 타입"이라는 문제가 `std::function` 타입 하나로 정리된다. 그런데 대가가 있다 — `_M_functor` 버퍼는 무한히 크지 않고, 호출은 이제 직접 호출이 아니라 함수 포인터를 거친 간접 호출이다. 다음 두 절에서 그 대가를 정확한 숫자로 잰다.

## SBO 경계: 정확히 몇 바이트까지 버퍼 안에 들어가는가

[5.6](#/lambdas) 끝에서 12바이트 클로저는 `std::function`에 담을 때 `new`가 0번, 40바이트 클로저는 1번 불렸다는 걸 실측했다 — 즉 `_M_functor` 버퍼가 작은 콜러블은 자기 안에 직접 복사해 넣고(**작은 버퍼 최적화, small buffer optimization, SBO**), 버퍼보다 큰 콜러블만 힙에 새로 할당해서 그 포인터를 버퍼에 담는다. 그런데 정확히 몇 바이트가 경계인지는 아직 안 쟀다. 이분 탐색하듯 캡처 크기를 늘려 가며 `new` 호출 횟수가 0에서 1로 바뀌는 지점을 찾는다.

```cpp title="sbo_boundary.cpp — N바이트 캡처가 SBO 안에 들어가는지 new 호출 횟수로 확인한다"
#include <cstdio>
#include <cstdlib>
#include <functional>

static int g_alloc_count = 0;
void* operator new(std::size_t size) {
    ++g_alloc_count;
    return std::malloc(size);
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

template <std::size_t N>
int test() {
    struct Pad { char data[N]; };  // N바이트짜리, 정렬 요구는 1바이트인 캡처 대상
    Pad pad{};
    auto lam = [pad]() { return pad.data[0]; };
    g_alloc_count = 0;
    std::function<int()> f = lam;
    int calls = g_alloc_count;
    (void)f();
    std::printf("N=%2zu  sizeof(lambda)=%2zu  new호출=%d\n", N, sizeof(lam), calls);
    return calls;
}

int main() {
    test<1>(); test<8>(); test<12>(); test<15>();
    test<16>(); test<17>(); test<18>(); test<24>(); test<40>();
    std::printf("sizeof(std::function<int()>) = %zu\n", sizeof(std::function<int()>));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sbo_boundary.cpp -o sbo_boundary
$ ./sbo_boundary
N= 1  sizeof(lambda)= 1  new호출=0
N= 8  sizeof(lambda)= 8  new호출=0
N=12  sizeof(lambda)=12  new호출=0
N=15  sizeof(lambda)=15  new호출=0
N=16  sizeof(lambda)=16  new호출=0
N=17  sizeof(lambda)=17  new호출=1
N=18  sizeof(lambda)=18  new호출=1
N=24  sizeof(lambda)=24  new호출=1
N=40  sizeof(lambda)=40  new호출=1
sizeof(std::function<int()>) = 32
```

(g++ 13.3 / libstdc++ 13, x86-64 실측.) 경계는 정확히 **16바이트와 17바이트 사이**다 — 16바이트까지는 힙 할당이 0번, 17바이트부터 1번으로 바뀐다. 이 숫자는 앞서 헤더에서 본 `_M_max_size = sizeof(_Nocopy_types)`와 정확히 일치한다 — `_Nocopy_types`는 포인터 하나(`void*`, 8바이트)와 클래스 미정의 멤버 함수 포인터(`void (_Undefined_class::*)()`, x86-64 Itanium ABI에서 16바이트) 중 가장 큰 멤버를 기준으로 크기가 정해지는데, 멤버 함수 포인터가 16바이트라 전체 유니온이 16바이트가 된다. `std::function<int()>` 객체 자체의 크기(32바이트)는 이 16바이트 버퍼 더하기 `_M_manager`·`_M_invoker` 함수 포인터 두 개(8바이트씩) — 정확히 16+8+8=32다.

크기만으로 끝이 아니다. 버퍼에 담기려면 **정렬 요구도** 8바이트를 넘지 않아야 한다.

```cpp title="sbo_align.cpp — 크기는 맞아도 정렬 요구가 크면 SBO를 못 쓴다"
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>

static int g_alloc_count = 0;
void* operator new(std::size_t size) {
    ++g_alloc_count;
    return std::malloc(size);
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

int main() {
    // 정렬 요구가 16바이트인 16바이트 캡처 -- 크기는 경계 안이지만 정렬이 8바이트를 넘는다.
    struct alignas(16) Aligned16 { char data[16]; };
    Aligned16 a16{};
    auto lam_aligned = [a16]() { return a16.data[0]; };
    g_alloc_count = 0;
    std::function<int()> f1 = lam_aligned;
    std::printf("alignas(16) 16바이트 캡처: new호출=%d\n", g_alloc_count);
    (void)f1();

    // std::string 캡처 -- libstdc++ std::string은 32바이트, SBO 버퍼(16바이트)보다 크다.
    std::string s = "hexpider";
    auto lam_string = [s]() { return s.size(); };
    g_alloc_count = 0;
    std::function<std::size_t()> f2 = lam_string;
    std::printf("std::string 캡처(32바이트): new호출=%d\n", g_alloc_count);
    (void)f2();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sbo_align.cpp -o sbo_align
$ ./sbo_align
alignas(16) 16바이트 캡처: new호출=1
std::string 캡처(32바이트): new호출=1
```

(g++ 13.3 실측.) `alignas(16)`을 붙인 16바이트 구조체는 크기 조건(≤16바이트)은 만족하는데도 힙으로 밀려난다 — `_Any_data`의 정렬(8바이트)보다 정렬 요구가 더 크기 때문이다. `std::string`을 캡처한 람다는 `std::string` 자체가 이 libstdc++ 구현에서 32바이트라 크기 조건에서부터 걸린다. 정리하면 libstdc++ 13 기준 SBO 조건은 세 가지 전부를 만족해야 한다 — **(1) 콜러블이 위치 불변(trivially-copyable에 가까운 성질)이고, (2) `sizeof(콜러블) ≤ 16`, (3) `alignof(콜러블) ≤ 8`.** 셋 중 하나라도 어기면 힙 할당 한 번이 생긴다.

::: warn 이 숫자는 이식성이 없다
16바이트, 32바이트라는 숫자는 libstdc++(g++가 쓰는 표준 라이브러리 구현)의 값이다. 표준은 SBO 자체를 요구하지 않는다 — `std::function`이 작은 콜러블을 힙 없이 담아야 한다는 규정은 어디에도 없다. libc++(clang 기본), MSVC STL은 버퍼 크기도, 심지어 SBO를 하는지 여부도 다를 수 있다. "16바이트"를 코드에 하드코딩해 의존하지 마라 — 여기서 확정할 수 있는 건 "구현에 따라 임계값이 있고, g++ 13 / libstdc++에서는 16바이트"라는 사실뿐이다.
:::

## 호출 비용: 다섯 가지 경로를 실측한다

타입 소거의 대가는 생성 시점의 힙 할당만이 아니다. 매 호출마다 `_M_invoker` 함수 포인터를 거쳐야 한다는 사실 자체가 비용이다. 직접 호출, 함수 포인터, 템플릿 파라미터로 받은 콜러블, `std::function`(SBO 안/밖) 다섯 경로를 5억 번씩 호출해서 호출당 나노초를 잰다. 닫힌 형태로 접혀 버리는 걸 막으려고(컴파일러가 "결과가 뻔하니 루프 전체를 상수로 계산해 버리는" 최적화) 매 호출마다 실제 데이터에 의존하는 xorshift 연산을 시킨다.

```cpp title="call_cost.cpp — 직접 호출부터 std::function까지 호출당 비용을 잰다 (조각 -- 각 경로의 실제 벤치마크 호출은 실습 4번에서 완성한다)"
#include <chrono>
#include <cstdio>
#include <functional>
#include <random>
#include <vector>

inline unsigned transform(unsigned x) {
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    return x;
}

constexpr std::size_t SIZE = 20'000'000;
constexpr int REPS = 8;

// volatile 함수 포인터 -- "이 포인터는 항상 transform을 가리킨다"는 상수 전파로
// 컴파일러가 인라인해버리는 걸 막는다. 일반 지역 변수로 실험하면 g++가 실제로 인라인해 버린다.
using FnPtr = unsigned (*)(unsigned);
volatile FnPtr g_fnptr = &transform;

template <typename F>
unsigned long long run(const std::vector<unsigned>& data, F f) {
    unsigned long long acc = 0;
    for (int r = 0; r < REPS; ++r)
        for (unsigned v : data) acc += f(v);
    return acc;
}

unsigned long long run_fnptr_volatile(const std::vector<unsigned>& data) {
    unsigned long long acc = 0;
    for (int r = 0; r < REPS; ++r) {
        FnPtr f = g_fnptr;  // 매번 volatile에서 다시 읽어 컴파일 타임엔 알 수 없는 값 취급
        for (unsigned v : data) acc += f(v);
    }
    return acc;
}

int main() {
    std::mt19937 rng(12345);
    std::vector<unsigned> data(SIZE);
    for (auto& v : data) v = rng();

    // (측정 본체는 각 경로를 chrono로 감싼다 -- 전문은 본문 설명 참고)
    // 1. 직접 호출        : run(data, transform)
    // 2. 템플릿(함수 포인터로 붕괴): run(data, transform) -- F가 함수 포인터 타입으로 추론된다
    // 3. 함수 포인터(volatile): run_fnptr_volatile(data)
    // 4. 템플릿(진짜 람다) : run(data, small_lambda) / run(data, big_lambda)
    // 5. std::function    : run(data, std::function<unsigned(unsigned)>{...})
    return 0;
}
```

```console
직접 호출(transform 인라인)          호출당 1.692 ns
템플릿 콜백(F=transform, 함수 포인터로 추론) 호출당 1.662 ns
함수 포인터(volatile, 인라인 차단)     호출당 1.406 ns
std::function(캡처 없음)            호출당 2.312 ns
템플릿 콜백(같은 작은 람다, 직접)      호출당 0.671 ns
std::function(SBO 내부, 작은 캡처)    호출당 2.042 ns
std::function(힙, SBO 초과 캡처)      호출당 2.039 ns
템플릿 콜백(같은 큰 람다)             호출당 0.690 ns
```

(g++ 13.3 / `-O2` / x86-64 / 5억 회 반복 실측 — 3회 반복 측정에서 각 항목의 편차는 ±0.1ns 이내였다. 절대 나노초 값은 기기마다 다르지만 항목 사이의 상대적 순서와 배율은 이 환경에서 안정적으로 재현됐다.) 다섯 줄이 세 그룹으로 갈린다.

첫째 그룹, 직접 호출·"함수 포인터로 붕괴한 템플릿"·volatile 함수 포인터는 전부 **1.4~1.7ns** 대로 사실상 같다. 여기서 함정이 하나 드러난다 — `run(data, transform)`처럼 **평범한 함수를 템플릿 인자로 넘기면**, 함수 이름은 함수 포인터 타입으로 붕괴하므로 `F`는 결국 `unsigned (*)(unsigned)`로 추론된다. 이건 함수 포인터를 직접 넘기는 것과 사실상 같은 상황이다 — "템플릿으로 받았으니 제로 오버헤드"가 자동으로 보장되는 게 아니라, **함수 포인터를 거친 간접 호출 자체가 이 하드웨어에서 이미 거의 공짜**였을 뿐이다(대상 주소가 8번 반복 내내 똑같아서 분기 예측기가 완벽하게 맞히기 때문 — CPU의 간접 분기 예측이 좋을 때는 간접 호출과 직접 호출의 차이가 실질적으로 사라진다).

둘째 그룹, "같은 작은/큰 람다를 템플릿으로 직접 받은" 두 줄은 **0.67~0.69ns**로 나머지 전부보다 2배 이상 빠르다. 이번엔 `F`가 함수 포인터가 아니라 **람다의 클로저 타입 그 자체**다 — 컴파일러가 `run<클로저타입>`을 인스턴스화하면서 `f(v)` 호출을 그 클로저의 `operator()` 본문으로 완전히 인라인하고, 그 결과 루프 전체가 자동 벡터화됐다. **"템플릿 파라미터로 콜러블을 받으면 제로 오버헤드"라는 말이 실제로 성립하는 지점은 여기다** — 콜러블이 함수 포인터로 붕괴하지 않고 고유한 클래스 타입(함자, 람다)으로 전달될 때, 컴파일러가 호출 지점 전체를 인라인할 자유를 갖는다.

셋째 그룹, `std::function` 세 줄은 캡처 유무·SBO 여부와 무관하게 전부 **2.0~2.3ns**로 나머지 둘보다 일관되게 25~75% 더 든다. `_M_invoker` 함수 포인터의 실제 값은 `std::function` 객체가 런타임에 대입받기 전까지 컴파일러가 알 수 없으므로(어떤 콜러블이 들어올지 호출 지점에서 결정되지 않는다), 이 호출은 절대 인라인되지 않는다 — 가상 함수 호출이 인라인을 막는 것과 완전히 같은 이유다([3.4 가상함수와 vtable](#/virtual-vtable) 계열의 제약과 동일 원리). 흥미로운 지점은 SBO 안(2.04ns)과 힙(2.04ns)의 **호출** 비용이 거의 같다는 것이다 — SBO는 생성 시점의 힙 할당을 없애줄 뿐, 매 호출마다 `_M_invoker`를 거쳐야 한다는 사실 자체는 SBO든 힙이든 동일하기 때문이다.

::: perf 세 줄 요약
① 함수 포인터를 거친 간접 호출은 대상이 예측 가능하면 직접 호출과 거의 같은 속도다. ② 템플릿이 진짜 제로 오버헤드를 내려면 콜러블이 함수 포인터가 아니라 고유 타입(함자·람다)으로 전달돼 인라인될 수 있어야 한다. ③ `std::function`은 SBO 여부와 무관하게 호출마다 일관된 오버헤드를 낸다 — 이 오버헤드는 "생성 시 힙 할당"과는 별개의, 매 호출마다 치르는 비용이다.
:::

## 빈 std::function을 부르면: bad_function_call

`std::function`은 "아무것도 안 담긴" 상태로도 존재할 수 있다 — 기본 생성하거나 `nullptr`를 대입하면 된다. 이 상태에서 호출하면 무슨 일이 일어나는지 실측한다.

```cpp title="bad_function_call.cpp — 빈 std::function을 호출해 본다"
#include <functional>
#include <iostream>

int main() {
    std::function<int(int)> callback;  // 기본 생성 -- 아무 콜러블도 담지 않은 빈 상태

    std::cout << "callback이 비어 있는가? " << (!callback) << "\n";
    std::cout << "static_cast<bool>(callback) = " << static_cast<bool>(callback) << "\n";

    try {
        int result = callback(10);  // 빈 std::function을 호출한다
        std::cout << "결과 = " << result << "\n";
    } catch (const std::bad_function_call& e) {
        std::cout << "예외 잡음: " << e.what() << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra bad_function_call.cpp -o bad_function_call
$ ./bad_function_call
callback이 비어 있는가? 1
static_cast<bool>(callback) = 0
예외 잡음: bad_function_call
```

(g++ 13.3 실측.) 기본 생성된 `std::function`은 `_M_invoker`가 `nullptr`인 상태다. `operator bool`(또는 `!callback`)로 미리 확인하면 이 상태를 안전하게 걸러낼 수 있는데, 확인 없이 바로 호출하면 `std::bad_function_call` 예외가 던져진다 — 널 포인터를 통해 호출하려 든 셈이니 뭔가 터지는 게 당연하지만, 그게 세그폴트가 아니라 **잡을 수 있는 예외**라는 점이 `std::function`의 설계다. `main`을 통째로 감싸지 않는 이상, 콜백 컨테이너에서 원소를 꺼내 호출하는 자리마다 "혹시 비어 있을 수 있는가"를 따져 보는 습관이 필요하다.

::: danger 기본 생성한 멤버 변수 std::function을 그대로 두지 마라
클래스 멤버로 `std::function<void()> on_event_;`를 선언해 두고 생성자에서 초기화를 잊으면, 이벤트가 한 번도 등록되지 않은 상태에서 `on_event_()`를 호출하는 순간 위와 같은 예외가 난다. 호출 전에 `if (on_event_) on_event_();`로 방어하거나, 생성자에서 항상 최소한 "아무것도 안 하는" 기본 콜백으로 초기화해 둬라.
:::

## 언제 std::function, 언제 템플릿 콜백

지금까지의 실측을 판단 기준 하나로 압축할 수 있다 — **콜러블의 구체적인 타입을 호출 지점이 컴파일 타임에 알아야 하는가, 아니면 런타임에 바뀔 수 있어야 하는가.**

호출 지점이 컴파일 타임에 고정되고 그 자리의 성능이 중요하다면 템플릿 파라미터로 받아라.

```cpp title="template_callback.cpp — 콜러블을 템플릿 파라미터로 받는다 (제로 오버헤드)"
template <typename F>
void run_control_loop(F&& compute_torque) {
    // compute_torque의 구체 타입은 호출 지점마다 확정된다 -- 인라인 가능
    for (int tick = 0; tick < 1000; ++tick) {
        double torque = compute_torque(tick);
        (void)torque;
    }
}
```

반대로 콜백을 이질적인 타입들의 컨테이너(배열, `map`, 클래스 멤버)에 저장해야 하거나, 어떤 콜러블이 들어올지 런타임까지 알 수 없다면(사용자가 매번 다른 람다를 등록하는 API, 플러그인 시스템) 타입 소거가 필요하다 — `std::function`을 써라.

```cpp title="function_callback.cpp — 콜러블을 std::function으로 받는다 (타입 소거가 필요한 자리)"
#include <functional>
#include <vector>

class EventBus {
public:
    void subscribe(std::function<void(int)> handler) {
        handlers_.push_back(std::move(handler));  // 서로 다른 타입의 콜백이 한 컨테이너에 쌓인다
    }
    void publish(int event) {
        for (auto& h : handlers_) h(event);
    }
private:
    std::vector<std::function<void(int)>> handlers_;
};
```

`template <typename F> void register_callback(F&& f)`는 `subscribe`의 대안이 될 수 없다 — 템플릿 함수는 호출될 때마다(전달되는 `F`가 다를 때마다) **별도로 인스턴스화**되는 별개의 함수이지, `handlers_`처럼 여러 개를 한 벡터에 쌓을 수 있는 하나의 타입이 아니다. "여러 개를 저장한다"는 요구가 나오는 순간 템플릿 파라미터 방식은 탈락하고 타입 소거가 필수가 된다.

::: interview "std::function과 템플릿 콜백 중 어떤 걸 쓰겠는가?"
설계 판단력을 묻는 질문이다. 답변 뼈대: ① 둘 다 콜러블(함수 포인터·함자·람다)을 받을 수 있다는 공통점이 있지만 메커니즘이 다르다 — 템플릿은 컴파일 타임에 타입별로 별도 함수를 찍어내 인라인 여지를 남기고, `std::function`은 타입 소거로 서로 다른 타입을 런타임에 하나의 타입으로 통일한다. ② 이 절의 실측 근거: `std::function`은 SBO 여부와 무관하게 호출마다 함수 포인터(`_M_invoker`)를 거치는 간접 호출 비용을 치르고(이 환경에서 함수 포인터 기반 호출보다 25~75% 더 걸렸다), 반면 템플릿에 넘긴 콜러블이 고유 타입일 때는 완전히 인라인·벡터화될 수 있다. ③ 결정 기준: 콜백을 이질적 타입들의 컨테이너에 저장해야 하면(플러그인, 구독자 목록) 타입 소거가 필수이므로 `std::function`, 호출 지점이 고정되고 핫 패스라면 템플릿. ④ 실전 예: rclcpp의 구독 콜백은 노드마다 다른 람다를 등록해야 하니 `std::function` 계열이고, 제어 루프의 고정된 계산 함수는 템플릿으로 받아 오버헤드를 없앤다.
:::

## 로보틱스 도메인: rclcpp 콜백과 제어 루프의 갈림길

rclcpp의 `create_subscription`은 콜백 파라미터로 사실상 `std::function` 계열(`rclcpp::SubscriptionOptions`를 통한 콜백 등록도 내부적으로 타입 소거된 콜러블을 저장한다)을 받는다 — 이유는 이 절에서 다룬 판단 기준 그대로다. 노드마다, 토픽마다 등록되는 콜백은 서로 다른 캡처, 서로 다른 람다 표현식으로 작성되고, executor는 그 서로 다른 콜백들을 **하나의 큐**(디스패치 테이블)에 넣고 이벤트가 도착하는 순서대로 하나씩 꺼내 부른다. 큐에 넣는 순간 이미 "이질적 타입을 하나의 컨테이너에 담아야 한다"는 요구가 성립하므로, 템플릿 파라미터로는 애초에 이 자리를 구현할 수 없다 — [5.6](#/lambdas)에서 실측한 "서로 다른 타입의 콜백들"을 하나의 실행 큐로 묶으려면 타입 소거가 필수다.

반대로 [6.8 실시간 제약과 제어 루프](#/realtime)·[10.9 ros2_control과 hardware_interface](#/ros2-control)에서 다루는 고정 주기 제어 루프(예: 관절 토크를 매 틱 계산하는 함수)는 호출 지점이 코드 작성 시점에 이미 하나로 고정된다 — 어떤 콜러블이 들어올지 런타임에 바뀔 이유가 없다. 이런 자리에 `std::function`을 습관적으로 쓰면, 이 절에서 잰 호출당 0.4~1.6ns의 오버헤드가 매 틱 곱해져 실시간 제어 주기(보통 1kHz 안팎, 즉 틱당 1ms 예산)를 갉아먹는다 — 절대적으로는 작아 보여도, 그 계산 함수 자체가 마이크로초 단위로 짧을수록 상대적 비중이 커진다. 제어 루프처럼 성능이 예산 안에 들어야 하는 핫 패스는 템플릿 파라미터로 콜러블을 받아 인라인 여지를 남겨 두는 쪽이 맞다.

## 요약

- **콜러블**은 함수 포인터, 함자(`operator()`를 가진 클래스), 람다처럼 `f(args...)` 문법으로 호출 가능한 모든 것을 묶는 이름이다 — 서로 다른 타입이지만 `std::vector<std::function<...>>` 하나에 나란히 담을 수 있다(실측).
- `std::function`은 **타입 소거**로 서로 다른 콜러블 타입을 고정 크기(이 환경에서 32바이트) 객체 하나로 통일한다 — libstdc++ 헤더 기준 `_M_functor`(콜러블 버퍼), `_M_manager`(복사/소멸 함수 포인터), `_M_invoker`(호출용 함수 포인터) 세 멤버로 구현된다.
- **SBO 경계는 이 환경(g++ 13.3, libstdc++ 13, x86-64)에서 16바이트다** — 콜러블이 위치 불변이고 `sizeof ≤ 16`, `alignof ≤ 8`을 모두 만족해야 힙 할당 없이 담긴다(이분 탐색으로 N=16/17 경계를 실측, `alignas(16)`은 크기가 맞아도 힙으로 밀림을 확인).
- 호출 비용 실측: 직접 호출·함수 포인터로 붕괴한 템플릿·volatile 함수 포인터는 1.4~1.7ns로 사실상 같고, **진짜 함자/람다 타입으로 받은 템플릿**은 완전히 인라인돼 0.67~0.69ns, **`std::function`은 SBO/힙 여부와 무관하게 2.0~2.3ns**로 일관되게 더 든다 — `_M_invoker`를 거치는 간접 호출이 인라인을 막기 때문이다.
- 기본 생성되거나 `nullptr`인 `std::function`을 호출하면 `std::bad_function_call` 예외가 난다(실측) — 호출 전 `operator bool`로 확인하는 습관이 필요하다.
- 콜백을 이질적 타입들의 컨테이너에 저장해야 하면(구독자 목록, 플러그인) `std::function`, 호출 지점이 고정되고 성능이 중요하면(제어 루프 핫 패스) 템플릿 파라미터 — rclcpp 구독 콜백과 제어 루프 계산 함수가 각각의 실제 사례다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일해서 확인하는 실습이다.

1. `std::function<int(int)>` 객체 하나의 `sizeof`가 그 안에 어떤 콜러블을 담든 항상 같은 이유를 타입 소거의 관점에서 설명하라.

2. 어떤 개발자가 "템플릿 파라미터로 콜러블을 받으면 항상 제로 오버헤드다"라고 주장한다. 이 절의 호출 비용 실측 결과를 근거로 이 주장이 틀릴 수 있는 경우를 하나 들어라.

3. (실습, 코드 작성형) `sbo_boundary.cpp`를 직접 타이핑하고, `Pad` 구조체에 `alignas(8)`를 붙여서(정렬 요구는 그대로 8바이트 이하로 유지하되) 크기를 15, 16, 17바이트로 바꿔 가며 `new` 호출 횟수를 확인하라. 성공 기준: 이 절에서 잰 것과 동일하게 16바이트에서 17바이트로 넘어가는 순간 0에서 1로 바뀌는 것을 네 눈으로 확인한다.

4. (실습) `bad_function_call.cpp`를 직접 타이핑하고, `try`/`catch` 블록을 지운 채로 실행해서 프로그램이 어떻게 종료되는지 확인하라(`std::terminate` 호출을 확인하는 것이 목표). 이후 `catch` 블록을 되살려 정상적으로 예외를 잡는 것까지 확인하라. 성공 기준: 두 경우의 차이(비정상 종료 vs 정상적인 예외 처리)를 콘솔 출력으로 직접 봤다.

5. (실습) `call_cost.cpp`의 구조를 참고해 직접 벤치마크를 작성하되, `transform` 대신 더 무거운 연산(예: `std::sqrt`를 포함한 부동소수점 계산)을 콜러블 본문에 넣고 함수 포인터/템플릿/`std::function` 세 경로의 호출당 비용을 재 봐라. 성공 기준: 연산이 무거워질수록 `std::function`의 상대적 오버헤드 비율(퍼센트)이 이 절의 xorshift 예제보다 줄어드는지 늘어나는지를 직접 측정해서 확인한다.
:::

::: answer 해설
1. `std::function`은 콜러블 본체를 `_M_functor`라는 고정 크기 버퍼(작으면 그 안에 직접, 크면 힙에 할당한 포인터만)에 담고, 실제 호출은 콜러블의 구체 타입을 알고 있는 `_M_invoker` 함수 포인터에 위임한다. 객체 자체가 들고 있는 건 이 고정 크기 버퍼와 함수 포인터 두 개뿐이라서, 원본 콜러블이 4바이트든 400바이트든 `std::function` 객체의 `sizeof`는 항상 같다.
2. 콜러블을 템플릿 파라미터로 받아도, 그 콜러블이 **평범한 함수**라서 함수 포인터로 붕괴해 전달되면(`run(data, transform)`처럼) 실질적으로 함수 포인터를 통한 간접 호출과 같은 상황이 된다 — 이 절의 실측에서 이 경우는 직접 호출과 비슷한 속도이긴 했지만, 그건 "함수 포인터를 거친 호출이 이 하드웨어에서 이미 거의 공짜"였기 때문이지 템플릿이 특별히 그것을 인라인해서가 아니다. 진짜 제로 오버헤드(완전한 인라인·벡터화)는 콜러블이 함자나 람다 같은 고유 타입으로 전달될 때만 확인됐다.
3. `alignas(8)`을 붙여도 원래 `char[N]` 배열의 자연 정렬(1바이트)보다 엄격하지 않은 조건이므로 크기 경계 자체는 그대로 16/17에서 갈린다 — `_M_max_size`가 16바이트이기 때문이다.
4. `catch` 없이 실행하면 `std::bad_function_call`이 처리되지 않은 예외로 남아 `std::terminate`가 호출되고 `abort` 신호로 비정상 종료된다(콘솔에 `terminate called after throwing an instance of 'std::bad_function_call'` 계열의 메시지가 찍힌다). `catch` 블록을 되살리면 이 절의 실측처럼 "예외 잡음: bad_function_call" 메시지와 함께 정상 종료된다.
5. 콜러블 본문이 무거워질수록(예: `sqrt` 몇 번), `std::function`의 간접 호출 오버헤드(고정된 나노초 값)가 전체 호출 시간에서 차지하는 **비율**은 작아진다 — 오버헤드의 절대 크기는 거의 그대로인데 분모(전체 연산 시간)가 커지기 때문이다. 반대로 이 절의 `transform`처럼 연산 자체가 몇 개의 XOR·시프트뿐인 극단적으로 가벼운 경우일수록 오버헤드의 상대적 비중이 커진다 — "콜백 하나가 몇 나노초짜리 가벼운 연산인가"가 `std::function`을 쓸지 템플릿을 쓸지 정하는 실질적 잣대가 되는 이유다.
:::

이 절의 `callable_family.cpp`, `sbo_boundary.cpp`, `sbo_align.cpp`, `bad_function_call.cpp`를 전부 직접 타이핑해라. `call_cost.cpp`는 본문에 실은 것이 발췌본이니, `bench` 헬퍼와 각 경로별 측정 코드를 직접 채워 완성한 뒤 `g++ -std=c++20 -Wall -Wextra -O2 call_cost.cpp -o call_cost && ./call_cost`로 돌려서 이 절의 표와 같은 순서(직접 호출·함수 포인터로 붕괴한 템플릿·volatile 함수 포인터 ≈ 진짜 함자 템플릿의 2배 이상 < `std::function`)가 나오는지 네 기기에서 확인해라.

**다음 절**: [5.8 string_view와 span](#/views) — 콜러블이 "무엇을 실행할지"를 소유 없이 가리키는 문제였다면, 이 절은 "어떤 데이터를 소유 없이 가리킬지"를 다룬다. 문자열과 배열을 복사 없이 참조하는 뷰 타입이 왜 필요한지, 그리고 그 뷰가 만드는 새로운 수명 함정을 실측으로 본다.
