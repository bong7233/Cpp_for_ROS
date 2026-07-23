# 2.7 이동 시맨틱과 rvalue 레퍼런스

::: lead
[2.6 복사 시맨틱](#/copy-semantics)에서 `Buffer`의 복사 생성자·복사 대입 연산자를 직접 써서 이중 해제를 고쳤다. 그런데 그 고침 자체가 새 낭비를 하나 만든다 — `Buffer make_buffer() { return Buffer(1000); }`처럼 함수가 만들어 반환하는 임시 버퍼를 받을 때조차, 지금 짠 코드는 어차피 몇 줄 뒤에 사라질 그 임시의 내용을 통째로 복사한다. 원본이 계속 쓰일 객체라면 복사가 유일한 선택이다. 하지만 원본이 **곧 버려질 임시**라면, 내용을 베낄 게 아니라 그 자원 자체를 통째로 넘겨받으면 그만이다. 이 절은 그 구분을 문법으로 만드는 장치 — rvalue 레퍼런스와 `std::move` — 를 실측과 함께 다룬다.
:::

## 1. 깊은 복사로 고친 뒤에도 남는 낭비

`make_buffer`가 만든 임시를 이미 존재하는 변수에 대입하는 코드부터 잰다. `Buffer(n)`을 반환하는 자리 자체는 C++17의 필수 복사 생략(mandatory copy elision, [1.6](#/functions)에서 다룬 RVO의 강화판) 덕에 복사 없이 만들어진다. 문제는 그다음이다 — 이미 있는 변수 `buf`에 그 결과를 **대입**하면, `Buffer`에는 아직 이동 대입 연산자가 없으니 [2.6](#/copy-semantics)에서 쓴 복사 대입 연산자가 대신 호출된다.

```cpp title="make_buffer_cost.cpp — 임시를 기존 변수에 대입 (2.6의 Buffer, 이동 없음)"
Buffer make_buffer(std::size_t n) { return Buffer(n); }  // 반환 자체는 복사 없이 만들어진다(RVO)

int main() {
    constexpr std::size_t N = 10'000'000;   // 38MB
    constexpr int REPEAT = 20;
    Buffer buf(1);
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < REPEAT; ++i) {
        buf = make_buffer(N);   // 대입: 복사 대입 연산자가 선택된다 -- 아직 이동이 없다
    }
    auto t1 = std::chrono::steady_clock::now();
    // ... 시간 측정 출력
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 make_buffer_cost.cpp -o make_buffer_cost
$ ./make_buffer_cost
버퍼 크기: 38 MB
buf = make_buffer(N) 총 20회: 1315.7 ms
1회 평균: 65.7851 ms
```

(g++ 13.3 / `-O2` / Linux x86-64 실측. 반복 실행에서 41~66ms 사이로 흔들렸다 — 이 파이프라인은 `make_buffer` 내부의 `new[]`+채우기와 대입 연산자의 `new[]`+`memcpy`를 합쳐서 매번 두 번의 38MB급 작업을 하기 때문에 [2.6](#/copy-semantics)에서 잰 순수 복사 1회(23.3ms)보다도 길다.) `buf = make_buffer(N);`이 끝나는 순간 `make_buffer`가 만든 임시는 소멸자가 호출돼 자기 버퍼를 `delete[]`한다. **그 버퍼는 방금 `memcpy`로 통째로 베껴진 뒤, 원본은 그대로 버려졌다.** 복사한 13바이트든 38MB든, 원본이 애초에 다시 쓰일 일이 없었다면 그 복사는 처음부터 필요 없는 일이었다.

::: perf 이게 왜 문제인가
[6.8 실시간 제약과 제어 루프](#/realtime)의 1ms 주기 제어 루프 안에서 센서 상태를 만들어 반환하는 함수가 이런 식으로 대입된다면, 매 주기 38MB 규모까지는 아니어도 킬로바이트 단위 복사가 반복적으로 발생한다. 복사 자체가 문제가 아니라 **그 복사가 아무 이득 없이 임시를 위해서만 일어난다는 것**이 문제다.
:::

## 2. 값 범주: lvalue와 rvalue를 실용적으로 가르기

이 낭비를 없애려면 컴파일러가 "이 값이 계속 쓰일 원본인가, 곧 사라질 임시인가"를 구분할 방법이 있어야 한다. 그 구분의 이름이 **값 범주**(value category)다. 표준 문서는 glvalue, prvalue, xvalue까지 세분하지만, 실무에서 오버로드를 고르는 데 필요한 건 딱 두 질문이다.

- **lvalue**: 이름이 있고, 대입식 왼쪽에 놓일 수 있고, 나중에 다시 참조할 수 있는가? — 변수 `a`, `b`가 여기 해당한다.
- **rvalue**: 이 표현식이 평가된 직후 사라질 임시인가? — 함수가 값으로 반환한 결과(`make_buffer(N)`), 산술 연산의 결과(`x + 1`), 정수·부동소수점 리터럴(`42`, `3.14`)이 여기 해당한다.

`Buffer make_buffer(std::size_t n) { return Buffer(n); }`에서 `make_buffer(N)`이 만드는 결과물은 이름이 없다 — 그 값을 담을 변수를 선언하지 않는 한 이 표현식이 끝나는 줄에서 사라진다. 이런 값에는 "굳이 내용을 지켜 줄 이유"가 없다. 반대로 `Buffer buf(1);`의 `buf`는 이름이 있고 이후 코드에서 계속 쓰인다 — 그 내용을 함부로 훔쳐 갈 수 없다.

::: note 리터럴도 rvalue지만 문자열 리터럴은 예외다
정수·부동소수점 리터럴은 rvalue다. 다만 `"hello"`처럼 큰따옴표로 감싼 문자열 리터럴은 `const char[6]` 타입의 **lvalue** 다 — 프로그램이 실행되는 내내 존재하는 정적 배열을 가리키기 때문이다. `std::string s = "hello, robot!";`에서 오른쪽 `"hello, robot!"`은 lvalue 배열이지만, 그걸로 만들어지는 `std::string` 임시 객체(생성자 호출 결과)는 rvalue다 — 헷갈리는 지점이니 배열 리터럴 자체와 그것으로 만든 클래스 임시는 구분해서 봐라.
:::

## 3. rvalue 레퍼런스(&&): 복사와 이동을 오버로드로 가르는 문법

값 범주를 구분할 수 있다는 걸 알았으니, 이제 그 구분을 오버로드 해석에 실제로 반영할 문법이 필요하다. C++11은 **rvalue 레퍼런스**(`T&&`)라는 새 레퍼런스 종류를 추가했다. `const T&`가 lvalue와 rvalue를 **둘 다** 바인딩할 수 있는 것과 달리, `T&&`는 **rvalue에만** 바인딩된다 — 컴파일러가 오버로드를 고를 때 "이 인자가 곧 버려질 임시인가"를 판단할 수 있는 유일한 문법적 단서다.

```cpp title="rvalue_ref_basics.cpp — T&&는 rvalue에만 바인딩된다"
void take(const std::string&) { /* lvalue, rvalue 둘 다 여기로 온다 -- 지금까지 그랬다 */ }
void take(std::string&&)      { /* rvalue만 여기로 온다 -- 오버로드가 새로 생겼다 */ }

std::string a = "hello, robot!";
take(a);                    // a는 lvalue -- take(const std::string&) 선택
take(std::string("temp"));  // 임시는 rvalue -- take(std::string&&) 선택
```

이 오버로드 구분을 클래스의 생성자 자리에 그대로 적용한 것이 **복사 생성자**(`Buffer(const Buffer&)`)와 **이동 생성자**(`Buffer(Buffer&&)`)의 나란한 관계다. 인자가 lvalue(계속 쓰일 원본)면 복사 생성자가, rvalue(곧 사라질 임시)면 이동 생성자가 선택된다. 왜 이 구분이 필요한지, 복사가 실제로 치르는 비용을 위젯으로 다시 확인한다.

::: widget ownership-move
{ "scenario": "copy" }
:::

스텝을 끝까지 넘겨 봐라. `std::string b = a;`가 힙에 새 버퍼를 **할당**하고 13바이트를 **한 바이트씩 옮겨 채우는** 과정 전체가 애니메이션으로 보인다 — `a`의 버퍼는 그대로 남고, `b`는 완전히 새로운 버퍼를 갖는다. 이 O(n) 비용 전부가, `a`가 곧 쓰이지 않을 값이었다면 처음부터 필요 없었을 일이다. `Buffer(const Buffer&)`가 정확히 이 그림을 코드로 옮긴 것이고, 다음 절에서 볼 `Buffer(Buffer&&)`는 이 그림 자체를 다르게 그린다.

## 4. 이동 생성자와 이동 대입 연산자 직접 쓰기

이동 생성자의 규칙은 복사 생성자와 정반대다. **새 자원을 만들지 않는다.** 상대의 포인터를 그대로 가져오고("훔치기"), 상대는 안전하게 파괴될 수 있는 빈 상태로 만든다.

```cpp title="buffer_move.cpp — Buffer에 이동 생성자·이동 대입 연산자 추가"
class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) {
        for (std::size_t i = 0; i < n; ++i) data_[i] = static_cast<int>(i);
    }
    Buffer(const Buffer& other) : size_(other.size_), data_(new int[other.size_]) {
        std::memcpy(data_, other.data_, size_ * sizeof(int));
    }

    // 이동 생성자 -- 포인터 3개만 옮기고 원본을 nullptr로 되돌린다
    Buffer(Buffer&& other) noexcept
        : size_(other.size_), data_(other.data_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }

    Buffer& operator=(const Buffer& other) {
        if (this == &other) return *this;
        int* new_data = new int[other.size_];
        std::memcpy(new_data, other.data_, other.size_ * sizeof(int));
        delete[] data_;
        data_ = new_data;
        size_ = other.size_;
        return *this;
    }

    // 이동 대입 연산자 -- 자기 자원을 지우고, 상대 포인터를 가져오고, 상대를 비운다
    Buffer& operator=(Buffer&& other) noexcept {
        if (this == &other) return *this;
        delete[] data_;
        data_ = other.data_;
        size_ = other.size_;
        other.data_ = nullptr;
        other.size_ = 0;
        return *this;
    }

    ~Buffer() { delete[] data_; }
    std::size_t size_;
    int* data_;
};
```

이 정의를 넣고 다시 재면, `buf = make_buffer(N);`이 이제 복사 대입 대신 이동 대입 연산자를 고른다 — `make_buffer(N)`의 결과가 이름 없는 임시(rvalue)이기 때문이다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 make_buffer_move.cpp -o make_buffer_move
$ ./make_buffer_move
buf = make_buffer(N) 총 20회 (이동): 741.065 ms
1회 평균: 37.0533 ms
```

(반복 실행에서 19~37ms 사이로 흔들렸다.) 앞 절의 65.8ms보다는 줄었지만 눈에 띄게 극적이지는 않다 — 이 파이프라인의 시간 대부분은 여전히 `make_buffer` **내부**에서 `new[]`로 1000만 개의 `int`를 할당하고 채우는 데 든다. 이동이 없애는 건 그다음 단계, 즉 대입 시점의 `memcpy` 38MB뿐이다. 그 부분만 따로 떼어 재려면 이미 존재하는 두 버퍼 사이에서 이동 대입만 반복해야 한다.

```cpp title="move_assign_cost.cpp — 이미 존재하는 38MB 버퍼를 이동 대입만으로 200000번 주고받는다"
constexpr std::size_t N = 10'000'000;   // 38MB
constexpr int SWAPS = 200000;

Buffer a(N), b(1);
auto t0 = std::chrono::steady_clock::now();
for (int i = 0; i < SWAPS; ++i) {
    b = std::move(a);
    a = std::move(b);
}
auto t1 = std::chrono::steady_clock::now();
// 400000회 이동 대입에 대한 1회 평균 시간 계산
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 move_assign_cost.cpp -o move_assign_cost_o0
$ ./move_assign_cost_o0
400000회 이동 대입 총 시간: 1.62552 ms
이동 대입 1회 평균: 4.06381 ns
```

(g++ 13.3 / **`-O0`** / Linux x86-64 실측. 반복 실행에서 4.1~4.4ns 사이.) 38MB 버퍼를 옮기는 데 **4ns 남짓**이다 — [2.6](#/copy-semantics)에서 잰 순수 복사 1회(23.3ms = 2,330만ns)와 비교하면 자릿수로 6~7자리 차이다. 정확한 배율보다 이 자릿수 차이가 핵심이다: 이동이 건드리는 건 `data_`, `size_`, `size_`(capacity) 세 워드뿐이고, 버퍼 안의 바이트는 단 하나도 움직이지 않는다.

::: warn `-O2`로 재면 이 숫자가 물리적으로 불가능해진다 — 죽은 코드 제거를 의심하라
같은 코드를 `-O2`로 재면 이동 대입 1회가 0.008~0.01ns로 찍힌다. CPU 한 사이클이 3GHz에서 약 0.33ns인데, 이건 그보다도 30배 이상 작다 — 명령어 하나조차 실행할 시간이 아니다. `-O2 -S`로 어셈블리를 뽑아 두 `steady_clock::now()` 호출 사이를 확인하면 이유가 나온다: `operator delete[]` 호출이 딱 **한 번**만 남고, 200000번을 돌아야 할 `for` 루프 본문 자체가 통째로 사라져 있다 — 컴파일러가 "`b = std::move(a); a = std::move(b);`를 짝수 번 반복하면 `a`, `b`의 최종 상태가 매번 같다"는 것을 증명해 버려서, 루프를 실행할 필요가 없다고 판단했다. 실행하지 않은 코드의 실행 시간을 잰 셈이다. **측정 결과가 이론적 하한보다 작게 나오면 코드가 빠른 게 아니라 컴파일러가 그 코드를 지운 것부터 의심해라** — 이 함정 자체가 [8.6 마이크로벤치마크의 함정](#/benchmarking)의 주제이고, `-O0`으로 다시 잰 4ns대가 이 절에서 믿을 수 있는 유일한 숫자다.
:::

## 5. std::move의 정체: 캐스트일 뿐이다

`std::move(a)`라는 이름 때문에 뭔가를 옮기는 함수처럼 보이지만, **`std::move`는 아무 데이터도 옮기지 않는다.** 정체는 `static_cast<T&&>(a)`를 짧게 쓴 것뿐이다 — `a`의 값 범주를 rvalue로 강제로 바꿔서, 컴파일러가 이동 생성자·이동 대입 연산자 오버로드를 고르게 만드는 표식이다.

```cpp title="move_is_cast.cpp — std::move는 캐스트다"
std::string&& as_rvalue(std::string& s) {
    return std::move(s);   // static_cast<std::string&&>(s) 와 완전히 같다
}
```

```console
$ g++ -std=c++20 -O2 -S move_is_cast.cpp -o move_is_cast.s
```

```text title="as_rvalue의 -O2 어셈블리 — 함수 전체가 이것뿐이다"
_Z9as_rvalueRNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE:
        endbr64
        movq    %rdi, %rax
        ret
```

`std::string`의 어떤 필드도 읽지 않고, `memcpy`도 없고, `std::move`를 부르는 `call` 명령조차 없다 — 인자로 받은 포인터를 그대로 반환값 레지스터에 옮기고 끝이다. **타입만 바뀌었을 뿐 실행되는 코드는 항등 함수 하나다.** `-O0`으로 최적화 없이 재보면 `std::move`가 실제로 호출되는 걸 볼 수 있는데, 그 함수의 몸통도 "인자로 받은 참조를 그대로 반환한다"는 한 줄이 전부다 — 표준 라이브러리 구현 자체가 캐스트 이상을 하지 않는다는 뜻이다.

::: widget ownership-move
{ "scenario": "move" }
:::

스텝을 넘겨 가며 확인해라. `std::move(a)`가 실행되는 스텝의 캡션이 정확히 이 절의 결론과 같다 — "아무것도 옮기지 않는다, rvalue로 캐스팅해 표시만 붙인다." 그다음 스텝에서 `b`가 `a`의 `ptr`·`size`·`capacity` **세 값만** 그대로 받아 가는 것, 힙의 13바이트가 1바이트도 움직이지 않는 것, 마지막에 `a.ptr`이 `nullptr`로 정리되는 것까지 한 프레임씩 눈으로 따라가라.

## 6. moved-from 상태: 유효하지만 미지정

이동을 당한 객체(`a`)는 사라지지 않는다. 소멸자가 여전히 호출될 것이므로 **파괴 가능한 상태**여야 하고, 표준은 이를 "유효하지만 미지정"(valid but unspecified) 상태로 정의한다 — 객체가 클래스 불변식을 깨지 않는 유효한 상태에 있다는 것만 보장하고, 그 값이 정확히 무엇인지는 보장하지 않는다.

```cpp title="moved_from.cpp — 이동 후 a를 만지는 세 가지 경우"
std::string a = "hello, robot!";
std::string b = std::move(a);

// a.size(), a.empty() -- 컴파일도 되고 크래시도 안 나지만 값에 의존하면 안 된다
auto n = a.size();

a = "new";   // 재대입 -- 언제나 안전하다
```

```console
$ g++ -std=c++20 -Wall -Wextra moved_from.cpp -o moved_from
$ ./moved_from
b = "hello, robot!"
a.size() = 0
a.empty() = true
재대입 후 a = "new"
```

`libstdc++`(이 실측 환경)에서는 이동 후 `a`가 빈 문자열이 됐다. 다만 이건 **이 구현의 관찰된 동작이지 표준의 보장이 아니다** — 다른 표준 라이브러리 구현이거나 컴파일러 버전이 다르면 다른 값이 나올 수 있다. 표준이 실제로 보장하는 건 딱 하나, `std::string`의 이동 후 상태는 항상 **재대입하거나 파괴하기에 안전**하다는 것뿐이다.

::: danger moved-from 객체의 값을 읽고 그 값에 로직을 태우지 마라
`a.size()`가 이 환경에서 0으로 나왔다고 "이동 후에는 항상 크기가 0이다"라고 코드에 못 박으면, 다른 컴파일러·다른 표준 라이브러리에서 조용히 깨지는 버그를 심는 것이다. 이동 후 `a`에 대해 안전하다고 보장되는 연산은 **재대입**(`a = "new";`)과 **소멸**(스코프를 벗어남) 둘뿐이다. 값을 읽어야 한다면 이동을 하기 **전에** 읽어 둬라.
:::

::: widget ownership-move
{ "scenario": "move-then-use" }
:::

스텝을 마지막까지 넘겨라. `a.size()`를 호출하는 스텝에서 캡션이 경고(⚠)로 바뀌고 상자 테두리가 빨간색으로 변하는 것, 그리고 바로 다음 스텝의 `a = "new";`에서는 같은 회색 상자가 아무 경고 없이 새 버퍼(`"new"`, 3문자)를 받아 정상 상태로 돌아오는 것을 비교해 봐라 — **읽기는 위험, 재대입은 안전**이라는 이 절의 규칙이 같은 객체 위에서 정확히 갈린다.

## 7. 이동은 언제 자동으로 일어나는가

이동 생성자·이동 대입 연산자를 직접 쓰지 않아도, 컴파일러는 다음 두 상황에서 자동으로 이동을 고른다.

**함수가 지역 변수를 값으로 반환할 때.** `return local_buffer;`처럼 이름 있는 지역 변수를 반환하면, C++17의 필수 복사 생략(RVO, [1.6](#/functions))이 적용될 수 있는 경우엔 복사·이동조차 없이 반환 위치에 직접 만들어진다. RVO가 적용되지 않는 상황(조건에 따라 다른 지역 변수를 반환하는 경우 등)이라도, 표준은 그 지역 변수를 **암묵적으로 rvalue 취급해서** 이동 생성자를 우선 고르도록 규정한다 — 복사가 아니라 이동이 기본값이다.

**`std::vector`가 재할당할 때.** [2.6](#/copy-semantics)에서 `Buffer`에 이동 생성자가 없었을 때 `push_back` 100번에 복사가 227번 일어나는 걸 쟀다. 이제 이동 생성자·이동 대입 연산자에 `noexcept`를 붙인 `Buffer`로 같은 실험을 반복한다.

```cpp title="vector_moves.cpp — 2.6과 똑같은 실험, 이동 생성자만 추가"
std::vector<Buffer> v;
for (int i = 0; i < 100; ++i) v.push_back(Buffer(4));
std::cout << "copy_count=" << Buffer::copy_count
          << "  move_count=" << Buffer::move_count << "\n";
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 vector_moves.cpp -o vector_moves
$ ./vector_moves
push_back 100회 -- copy_count=0  move_count=227
```

같은 227번이 그대로 **복사에서 이동으로 통째로 옮겨 갔다.** `vector`가 재할당할 때 기존 원소를 새 버퍼로 옮기는 방법을 고르는 규칙은 "이동 생성자가 있고 그게 `noexcept`면 이동을 쓰고, 아니면 안전을 위해 복사를 쓴다"이다.

::: perf 왜 `noexcept`가 없으면 도로 복사로 돌아가는가
`vector`의 재할당은 강한 예외 보장([2.6 copy-and-swap](#/copy-semantics) 참고, [5.1 vector](#/vector)에서 정식으로 다룬다)을 지켜야 한다 — 재할당 도중 예외가 나면 원래 `vector`가 그대로 남아 있어야 한다. 이동은 기존 원소를 옮기는 도중에 실패하면 원본도 새 버퍼도 반쪽짜리 상태가 될 위험이 있어서, 이동 생성자가 예외를 던질 수 있다고 선언돼 있으면(`noexcept` 없음) `vector`는 안전하게 실패할 수 있는 복사를 선택한다. `noexcept`를 빼고 이 실험을 다시 돌리면 `copy_count`가 227로, `move_count`가 0으로 되돌아간다 — 직접 확인해 볼 가치가 있다.
:::

## 8. 로보틱스 도메인: 큰 센서 데이터를 함수 경계로 넘길 때

포인트클라우드, 카메라 프레임, LIDAR 스캔 같은 로봇의 센서 데이터는 수백 KB에서 수십 MB에 이른다. 이런 데이터를 필터링 함수에 값으로 넘기고 값으로 돌려받는 파이프라인을 짤 때, 함수 경계마다 복사가 하나씩 끼어드는 건 이 절에서 잰 38MB 복사 비용이 파이프라인 단수만큼 누적된다는 뜻이다. `std::move`로 넘기면 그 복사가 사라진다 — 호출자가 그 데이터를 더 이상 쓰지 않을 것이라는 걸 컴파일러에게 알려 주는 것뿐이다.

```cpp title="pointcloud_pipeline.cpp — 이동으로 넘기면 필터 단계마다 복사가 없다"
PointCloud filter_ground(PointCloud cloud);      // 값으로 받고 값으로 반환
PointCloud filter_noise(PointCloud cloud);

PointCloud process(PointCloud raw) {
    auto step1 = filter_ground(std::move(raw));   // raw를 더 안 쓸 거라고 알린다
    return filter_noise(std::move(step1));         // step1도 마찬가지
}
```

이 패턴은 rclcpp의 intra-process 통신에서 그대로 실전에 쓰인다. 같은 프로세스 안의 노드끼리 메시지를 주고받을 때, publisher가 메시지를 `std::unique_ptr`로 만들어 넘기면 subscriber는 그 소유권을 이동으로 받아 간다 — 직렬화도, 복사도 없이 포인터 하나만 옮겨진다. [10.2 토픽: publisher와 subscription](#/pub-sub)에서 이 메커니즘을 정식으로 다룬다. 지금 확인해 둘 건 하나다 — `unique_ptr`가 왜 복사를 막고 이동만 허용하는 타입인지는, 이 절에서 본 "포인터 세 개만 바꾼다"는 이동의 정의를 그대로 소유권 이전의 정의로 쓴 것이다([2.9 unique_ptr](#/unique-ptr)에서 이어진다).

::: interview std::move가 실제로 하는 일 / 왜 이동이 빠른가
메모리 질문 다음으로 자주 나오는 게 이동 시맨틱이다. 답변 뼈대: ① **`std::move`는 함수가 아니라 캐스트다** — `static_cast<T&&>(x)`를 줄인 것뿐이고, 아무 바이트도 옮기지 않는다(이 절의 `-O2` 어셈블리가 증거 — 함수 전체가 `mov`와 `ret` 두 줄이다). ② 이동이 빠른 이유는 **자원을 새로 할당하지 않고 소유권만 넘기기 때문**이다 — 포인터·크기 같은 몇 개의 워드만 복사하고, 원본은 그 값들을 잃고 안전하게 파괴될 수 있는 상태(대개 `nullptr`)로 정리된다. ③ 그 결과 이동 비용은 데이터 크기와 무관한 O(1)이고, 복사는 데이터 크기에 비례하는 O(n)이다 — 이 절 실측으로는 38MB 버퍼 기준 복사 23.3ms 대 이동 4ns, 자릿수로 6~7자리 차이다. ④ 이동 후 원본은 "유효하지만 미지정" 상태다 — 읽으면 안 되고, 재대입이나 파괴는 항상 안전하다. 여기까지 답하고 "언제 컴파일러가 자동으로 이동을 고르는가"(반환값, `noexcept` 이동 생성자가 있을 때의 `vector` 재할당)까지 붙이면 상급 답변이다.
:::

## 요약

- 함수가 반환하는 임시(rvalue)를 기존 변수에 대입하면, 이동 대입 연산자가 없는 한 복사 대입 연산자가 대신 호출된다 — 원본(임시)이 어차피 버려질 것이었다면 이 복사는 순수한 낭비다(실측: 대입 파이프라인 1회 평균 41~66ms).
- **값 범주**는 실용적으로 두 갈래다 — 이름이 있고 계속 참조되는 **lvalue**, 표현식이 끝나면 사라지는 **rvalue**(함수 반환값, 산술 결과, 숫자 리터럴).
- **rvalue 레퍼런스**(`T&&`)는 rvalue에만 바인딩되는 레퍼런스로, 이 문법 덕에 복사 생성자(`const T&`)와 이동 생성자(`T&&`)를 오버로드로 나눠 쓸 수 있다.
- **이동 생성자·이동 대입 연산자**는 새 자원을 만들지 않는다 — 포인터·크기 몇 개만 옮기고 원본을 안전한 빈 상태로 정리한다. 실측: 38MB 버퍼의 순수 이동 대입 1회 평균 4ns대(`-O0`) — 같은 크기 복사(23.3ms, [2.6](#/copy-semantics))와 자릿수로 6~7자리 차이. `-O2`로는 죽은 코드 제거 때문에 이 비교가 왜곡된다(실측·어셈블리로 확인).
- **`std::move`는 캐스트다** — `static_cast<T&&>(x)`를 줄인 것뿐이고, 그 자체는 아무것도 옮기지 않는다(실측: `-O2` 어셈블리 전체가 `mov`+`ret` 두 줄).
- 이동 후 객체는 **유효하지만 미지정** 상태다 — 재대입·파괴는 항상 안전하고, 값을 읽어 로직을 태우면 안 된다(실측: `libstdc++`에서는 빈 문자열이 됐지만 이는 구현 세부사항이지 표준 보장이 아니다).
- 이동은 **함수의 값 반환**(RVO가 안 되는 경우도 컴파일러가 지역 변수를 암묵적으로 rvalue 취급)과 **`vector`의 재할당**(이동 생성자가 `noexcept`일 때) 두 곳에서 자동으로 일어난다 — 실측: 2.6의 복사 227회가 이동 227회로 그대로 옮겨 갔다(`noexcept` 없으면 도로 복사로 돌아간다).

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습(코드 작성형)이다.

1. `std::move(a)`를 실행해도 "아무것도 옮기지 않는다"는 게 정확히 무슨 뜻인가? 이 절의 `-O2` 어셈블리 실측이 그 주장의 어떤 부분을 증명하는지 설명하라.

2. `move_assign_cost.cpp`를 `-O2`로 빌드하면 이동 대입 1회가 0.01ns 근처로 나온다. 이 숫자를 믿으면 안 되는 이유를 CPU 클럭 속도와 연결해 설명하고, 진짜 원인(어셈블리에서 무엇이 사라졌는지)을 써라.

3. `moved_from.cpp`에서 `a = "new";` 대신 `a.push_back('!');`를 이동 직후에 호출하면 컴파일은 되는가, 실행 시 안전한가? "재대입은 안전, 값을 읽는 건 위험"이라는 규칙에 `push_back`이 어느 쪽에 더 가까운지 논리를 먼저 써라(힌트: `push_back`은 대입과 달리 기존 상태를 참조할 수 있다).

4. (실습) `deep_copy.cpp`([2.6](#/copy-semantics))의 `Buffer`에 이 절의 이동 생성자·이동 대입 연산자를 그대로 추가하고, `Buffer a(1000000), b(1);`을 만든 뒤 `b = std::move(a);`를 실행하라. 그다음 `std::cout << a.data_ << "\n";`으로 `a.data_`가 `nullptr`(0)로 찍히는지 확인하라. 성공 기준: 이동 후 `a.data_`가 정확히 0이다.
5. (실습) `vector_moves.cpp`를 그대로 타이핑하고 `-O2`로 빌드해 `copy_count=0, move_count=227`을 직접 확인하라. 그다음 이동 생성자·이동 대입 연산자의 `noexcept`를 둘 다 지우고 다시 빌드·실행해 숫자가 어떻게 바뀌는지 재라. 성공 기준: `noexcept`를 뺐을 때 `copy_count`가 다시 227 근처로 돌아오고 `move_count`가 0에 가까워지는 것을 실측했다.
:::

::: answer 해설
1. `std::move(a)`는 `a`의 값 범주를 rvalue로 바꾸는 캐스트일 뿐이다 — 힙의 바이트도, 스택의 필드도 이 호출 자체로는 아무것도 바뀌지 않는다. "옮기는 일"은 그 결과를 넘겨받는 이동 생성자·이동 대입 연산자가 한다. `-O2` 어셈블리 실측(`as_rvalue` 함수 전체가 `mov %rdi, %rax; ret` 두 줄)이 증명하는 건 정확히 이 지점이다 — `std::string`의 어떤 멤버도 읽거나 쓰지 않고, `std::move`를 호출하는 `call` 명령조차 남지 않는다. 인자로 받은 포인터를 그대로 반환할 뿐인 항등 함수와 기계어 수준에서 동일하다.
2. CPU 한 사이클은 3GHz 기준 약 0.33ns다. 0.01ns는 그 30분의 1 수준이라 명령어 하나조차 실행할 시간이 못 된다 — 물리적으로 불가능한 값이다. `-O2 -S`로 어셈블리를 확인하면 두 `steady_clock::now()` 호출 사이에 `operator delete[]` 호출이 단 한 번만 남아 있고 200000번 돌아야 할 루프 자체가 사라져 있다 — 컴파일러가 `b = std::move(a); a = std::move(b);`를 짝수 번 반복하면 최종 상태가 매번 같다는 것을 증명해서 루프 전체를 실행하지 않아도 된다고 판단했다. 측정한 건 "실행되지 않은 코드"의 시간이다.
3. 컴파일은 된다 — `push_back`은 `std::string`의 멤버 함수이고 moved-from 상태도 유효한 객체이므로 호출 자체는 문법적으로 문제없다. 하지만 "값을 읽는" 쪽에 훨씬 가깝다 — `push_back`은 기존 버퍼에 공간이 남았는지, capacity를 넘었으면 재할당해야 하는지를 판단하려고 **기존 size·capacity 값을 참조**한다. moved-from 상태에서 그 값이 무엇인지가 표준에 보장돼 있지 않으므로(대개는 0이라 재할당부터 하겠지만, 그건 이 구현의 관찰된 동작이지 보장이 아니다), 재대입(`a = "new";`, 기존 값을 아예 안 보고 통째로 덮어씀)과 같은 급의 안전으로 취급하면 안 된다.
4. `b = std::move(a);` 실행 후 이동 생성자의 `other.data_ = nullptr;` 줄이 `a.data_`를 정확히 0(nullptr)으로 만든다. `a`가 스코프를 벗어나 소멸자가 호출돼도 `delete[] nullptr;`는 표준이 명시적으로 허용하는 안전한 무연산이라 크래시가 나지 않는다.
5. `noexcept`를 붙였을 때는 `vector`가 재할당 시 이동을 선택해 `move_count=227, copy_count=0`이 나온다. `noexcept`를 빼면 `vector`는 강한 예외 보장을 지키기 위해 도로 복사를 선택해 `copy_count`가 [2.6](#/copy-semantics)에서 잰 227에 가까운 값으로 돌아가고 `move_count`는 0에 가까워진다 — 이동 생성자가 있어도 `noexcept`가 없으면 `vector`가 그 이동을 신뢰하지 않는다는 걸 직접 확인하는 실습이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `move_assign_cost.cpp`는 `-O0`과 `-O2` 두 번 다 돌려서 죽은 코드 제거가 벤치마크를 얼마나 심하게 왜곡할 수 있는지 눈으로 확인하고, `vector_moves.cpp`는 `noexcept`를 넣고 뺀 두 버전을 나란히 돌려서 `vector`가 이동을 신뢰하는 조건을 직접 재봐라. 기준 명령: `g++ -std=c++20 -Wall -Wextra -O2 main.cpp -o main && ./main`.

**다음 절**: [2.8 Rule of 0/3/5](#/rule-of-five) — 지금까지 `Buffer`에 소멸자·복사 생성자·복사 대입 연산자·이동 생성자·이동 대입 연산자, 다섯 개를 전부 손으로 썼다. 이 다섯 개를 언제 다 써야 하고, 언제 전혀 안 써도 되는지(Rule of 0)를 가르는 경험칙과 `=default`/`=delete`로 그 경계를 명시적으로 선언하는 문법을 다음 절에서 정리한다.
