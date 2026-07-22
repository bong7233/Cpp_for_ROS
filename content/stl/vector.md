# 5.1 vector: 내부 구조와 성장 전략

::: lead
[4.7](#/type-deduction)에서 `std::vector<bool>::operator[]`가 진짜 `bool&`가 아니라 프록시를 돌려주고, 그 프록시가 재할당된 버퍼를 참조하면 `heap-use-after-free`가 난다는 걸 실측했다. 그 사고의 원인은 결국 하나로 좁혀진다 — `vector`가 원소를 담는 버퍼를 통째로 새로 만들고 기존 원소를 옮기는 **재할당**이다. `push_back`을 한 줄 부르는 게 매번 똑같은 비용이라고 생각하기 쉽지만, 실제로는 어떤 호출은 몇 나노초에 끝나고 어떤 호출은 그보다 몇만 배 느리다. 이 절은 그 차이가 어디서 오는지 — `vector`의 실제 메모리 구조, capacity가 커지는 배율, 재할당이 기존 원소에 복사를 시키는지 이동을 시키는지 — 를 전부 실측으로 확인한다.
:::

## push_back이 항상 같은 속도가 아니다

`std::vector<int> v; v.push_back(x);`를 100만 번 반복하면서 호출 하나하나의 시간을 직접 재 보면, 대부분은 수십 나노초 안에 끝나지만 드물게 훨씬 오래 걸리는 호출이 섞여 있다.

```cpp title="push_jitter.cpp — push_back 100만 번, 매 호출의 시간을 개별로 잰다"
#include <chrono>
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v;
    std::size_t last_cap = 0;

    for (int i = 0; i < 1'000'000; ++i) {
        auto t0 = std::chrono::steady_clock::now();
        v.push_back(i);
        auto t1 = std::chrono::steady_clock::now();

        if (v.capacity() != last_cap) {   // capacity가 바뀐 호출만 골라 찍는다
            auto ns = std::chrono::duration<double, std::nano>(t1 - t0).count();
            std::cout << "push #" << i << "  새 capacity=" << v.capacity()
                      << "  이 1회 소요=" << ns << " ns\n";
            last_cap = v.capacity();
        }
    }

    auto t0 = std::chrono::steady_clock::now();
    v.push_back(0);
    auto t1 = std::chrono::steady_clock::now();
    std::cout << "재할당 없는 push_back 1회 소요="
              << std::chrono::duration<double, std::nano>(t1 - t0).count() << " ns\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 push_jitter.cpp -o push_jitter
$ ./push_jitter
push #0  새 capacity=1  이 1회 소요=410 ns
push #1  새 capacity=2  이 1회 소요=959 ns
push #2  새 capacity=4  이 1회 소요=120 ns
...
push #65536  새 capacity=131072  이 1회 소요=220767 ns
push #131072  새 capacity=262144  이 1회 소요=276690 ns
push #262144  새 capacity=524288  이 1회 소요=736636 ns
push #524288  새 capacity=1048576  이 1회 소요=1.33014e+06 ns
재할당 없는 push_back 1회 소요=25 ns
```

(g++ 13.3 / `-O2` / Linux x86-64 실측. 나노초 값은 실행마다 흔들리지만 자릿수 차이는 재현된다.) 재할당이 없는 평범한 `push_back`은 **25ns**로 끝났다. 반면 원소 524,288개짜리 버퍼를 통째로 새 자리에 옮기는 재할당 한 번은 **약 1.33ms**(1,330,140ns) 걸렸다 — 평범한 호출보다 5만 배 넘게 느리다. `push_back`이 "대체로 빠르지만 가끔 아주 느리게 튄다"는 이 비대칭이 이 절 전체의 출발점이다. 재할당이 정확히 무엇을 하길래 이렇게 느린지 보려면 먼저 `vector`가 메모리 안에서 어떻게 생겼는지부터 봐야 한다.

## vector의 내부 표현: 포인터 세 개

`std::vector<T>`가 들고 있는 상태는 원소 자체가 아니라 **원소를 가리키는 포인터 세 개**뿐이다. libstdc++ 구현은 이 세 포인터에 각각 `_M_start`(원소 버퍼의 시작), `_M_finish`(채워진 원소의 끝, 즉 `size()`가 가리키는 지점), `_M_end_of_storage`(할당된 버퍼 전체의 끝, 즉 `capacity()`가 가리키는 지점)라는 이름을 붙인다. `sizeof`로 이 구조를 직접 확인할 수 있다.

```cpp title="sizeof_vector.cpp — vector 객체 자체의 크기를 잰다"
#include <iostream>
#include <vector>

int main() {
    std::cout << "sizeof(std::vector<int>) = " << sizeof(std::vector<int>) << " bytes\n";
    std::cout << "sizeof(void*) = " << sizeof(void*) << " bytes\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sizeof_vector.cpp -o sizeof_vector
$ ./sizeof_vector
sizeof(std::vector<int>) = 24 bytes
sizeof(void*) = 8 bytes
```

(g++ 13.3 / x86-64 실측.) `std::vector<int>` 객체 자체는 원소가 3개든 3백만 개든 정확히 **24바이트** — 포인터 3개(8바이트 × 3)다. 원소가 담긴 실제 버퍼는 `vector` 객체와 별개로 힙에 따로 있고, `vector`는 그 버퍼를 가리키는 좌표 세 개만 쥐고 있다.

```text nolines
vector<int> 객체 (24바이트, 스택 또는 부모 컨테이너 안)

  [ begin_ ][ end_ ][ end_of_storage_ ]

힙에 할당된 원소 버퍼 (capacity=8, size=4인 상태)

  [ 0 ][ 1 ][ 2 ][ 3 ][ ? ][ ? ][ ? ][ ? ]
    ^begin_             ^end_             ^end_of_storage_
```

`begin_`은 항상 버퍼의 첫 원소를 가리키고, `end_`는 마지막으로 채워진 원소 바로 다음(one-past-end, [1.7](#/arrays-strings)에서 본 규칙과 같다)을, `end_of_storage_`는 할당된 버퍼 전체가 끝나는 지점을 가리킨다. `end_`와 `end_of_storage_` 사이, 즉 그림에서 `?`로 표시한 자리는 **할당은 됐지만 아직 원소가 생성되지 않은 메모리**다 — `new`만 됐지 생성자가 안 불린 raw storage라는 뜻이다.

## capacity와 size: 서로 다른 질문에 대한 답

앞의 그림에서 `size()`는 `end_ - begin_`을, `capacity()`는 `end_of_storage_ - begin_`을 계산한 값이다. 둘은 완전히 다른 질문에 답한다.

- **`size()`**: "지금 몇 개의 원소가 실제로 들어 있는가?" — 원소를 순회하거나 `operator[]`로 접근할 수 있는 범위다.
- **`capacity()`**: "다음 `push_back`이 재할당 없이 성공할 수 있는가?" — 버퍼에 이미 확보된 공간의 크기다.

`capacity() >= size()`는 언제나 성립한다. 그 차이(`capacity() - size()`)만큼은 이미 할당돼 있지만 아직 원소가 없는 여유 공간이고, 이 여유가 있는 동안은 `push_back`이 재할당을 건너뛴다 — 앞선 실측에서 25ns로 끝난 호출이 정확히 이 경우다. 여유가 바닥나는 순간(`size() == capacity()`인 상태에서 `push_back`을 한 번 더 부르는 순간)에만 재할당이 일어난다.

::: note capacity가 size보다 커도 안전한 이유
`end_`와 `end_of_storage_` 사이의 미생성 공간은 `vector`가 배타적으로 소유한 메모리다. 다른 어떤 코드도 그 자리를 침범하지 않으므로, `push_back`은 그 공간에 새 원소를 생성자로 직접 지어 넣기만 하면 된다 — 별도의 할당도, 기존 원소를 건드릴 필요도 없다. `capacity`가 큰 게 위험해지는 유일한 경우는 메모리를 낭비한다는 것뿐이고, `shrink_to_fit()`이 그 낭비를 되돌리는 요청이다(강제는 아니다 — 표준은 구현이 이 요청을 무시해도 된다고 허용한다).
:::

## 성장 전략 실측: capacity는 몇 배씩 크는가

여유 공간이 바닥나 재할당이 일어날 때, 새 버퍼의 크기를 얼마로 잡을지는 **C++ 표준이 정하지 않는다.** 표준은 `push_back`을 $n$번 호출했을 때 전체 시간이 분할 상환(amortized) $O(n)$이어야 한다는 결과만 요구하고, 그 결과를 만들어 내는 배율은 구현이 자유롭게 고른다. libstdc++가 실제로 어떤 배율을 쓰는지는 `capacity()`를 반복 출력해서 직접 확인하는 수밖에 없다.

```cpp title="growth_factor.cpp — capacity가 바뀔 때마다 그 값을 찍는다"
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v;
    std::size_t last_cap = 0;
    for (int i = 0; i < 40; ++i) {
        v.push_back(i);
        if (v.capacity() != last_cap) {
            std::cout << "size=" << v.size() << "  capacity=" << v.capacity() << "\n";
            last_cap = v.capacity();
        }
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra growth_factor.cpp -o growth_factor
$ ./growth_factor
size=1  capacity=1
size=2  capacity=2
size=3  capacity=4
size=5  capacity=8
size=9  capacity=16
size=17  capacity=32
size=33  capacity=64
```

(g++ 13.3 / libstdc++ / x86-64 실측.) capacity가 1 → 2 → 4 → 8 → 16 → 32 → 64로, **매번 정확히 두 배**로 뛴다. 이 절 첫머리의 `push_jitter.cpp` 출력에 찍힌 `new capacity=131072`, `262144`, `524288`, `1048576`도 같은 두 배 규칙이 100만 단위까지 그대로 이어진 것이다. 이 배율(growth factor)은 libstdc++의 선택이지 표준의 강제가 아니다 — 다른 표준 라이브러리 구현은 다른 배율을 고를 수 있고, 그 경우에도 여전히 분할 상환 $O(n)$이라는 표준의 요구는 만족한다. **이 절의 숫자는 g++ 13.3 / libstdc++ 기준이라는 점을 못 박아 둔다.**

::: deep 왜 하필 "배수"로 키우는가 — 상수 증가와의 차이
capacity를 매번 고정된 개수(예: +10)만큼 늘리는 전략과 비교하면 배수 성장의 이유가 분명해진다. 고정 증가라면 $n$번의 `push_back`마다 재할당이 $n/10$번 일어나고, 매 재할당마다 기존 원소 전체를 복사해야 하므로 총 비용이 $O(n^2)$에 가까워진다. 반면 배수로 키우면 재할당 횟수 자체가 $\log_2 n$번으로 줄고, 재할당 하나하나의 비용(기존 원소 복사)이 기하급수적으로 커지는 대신 그 횟수가 로그로 줄어드는 게 서로를 상쇄해 총합이 $O(n)$에 수렴한다 — "가끔 크게 튀지만 전체 평균은 저렴하다"는 분할 상환 분석의 핵심이 이 배수 전략 자체에서 나온다.
:::

## 재할당 비용: 기존 원소는 복사되는가, 이동되는가

재할당이 실제로 하는 일은 세 단계다. 새 버퍼를 (보통 두 배 크기로) 할당하고, 기존 원소를 전부 그 새 버퍼로 옮기고, 옛 버퍼를 해제한다. 문제는 "옮긴다"는 이 두 번째 단계가 복사인지 이동인지다 — [2.7 이동 시맨틱](#/move-semantics)에서 이미 다룬 규칙이 그대로 적용된다: **이동 생성자가 있고 그게 `noexcept`로 선언돼 있으면 이동을, 그렇지 않으면 안전을 위해 복사를 쓴다.** 로그를 찍는 타입 두 벌로 이 규칙을 직접 재현한다.

```cpp title="reloc_copyonly.cpp — 이동 생성자가 없는 타입: 재할당이 복사를 부른다"
#include <iostream>
#include <vector>

struct LoudCopyOnly {
    int id;
    static inline int copy_count = 0;
    static inline int move_count = 0;

    explicit LoudCopyOnly(int i) : id(i) {}
    LoudCopyOnly(const LoudCopyOnly& other) : id(other.id) { ++copy_count; }
    // 이동 생성자를 선언하지 않았다 -- 복사 생성자를 직접 썼으므로
    // 컴파일러가 암묵적으로 이동 생성자를 만들어 주지도 않는다(2.8절 Rule of 5)
};

int main() {
    std::vector<LoudCopyOnly> v;
    for (int i = 0; i < 20; ++i) v.emplace_back(i);
    std::cout << "copy_count=" << LoudCopyOnly::copy_count
              << "  move_count=" << LoudCopyOnly::move_count << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 reloc_copyonly.cpp -o reloc_copyonly
$ ./reloc_copyonly
copy_count=31  move_count=0
```

같은 코드에 `noexcept` 이동 생성자만 하나 추가하면 결과가 정반대로 뒤집힌다.

```cpp title="reloc_nomove.cpp — 이동 생성자를 noexcept로 추가한 버전"
struct Loud {
    int id;
    static inline int copy_count = 0;
    static inline int move_count = 0;

    explicit Loud(int i) : id(i) {}
    Loud(const Loud& other) : id(other.id) { ++copy_count; }
    Loud(Loud&& other) noexcept : id(other.id) { ++move_count; other.id = -1; }
};
// main()은 위와 동일 -- Loud::copy_count / Loud::move_count 를 출력
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 reloc_nomove.cpp -o reloc_nomove
$ ./reloc_nomove
copy_count=0  move_count=31
```

(g++ 13.3 / `-O2` 실측, 둘 다 20개 원소를 `emplace_back`한 결과.) 원소 20개를 채우는 동안 capacity는 1→2→4→8→16→32로 다섯 번 재할당됐고, 그때마다 옮겨야 했던 기존 원소 수의 합(1+2+4+8+16)이 정확히 **31**이다 — `emplace_back` 자체는 새 원소를 그 자리에서 바로 생성하므로 신규 원소분의 복사는 없고, 이 31이라는 숫자는 순수하게 "기존 원소를 새 버퍼로 옮기는 비용"이다. 이동 생성자가 없으면 그 31번이 전부 복사로, `noexcept` 이동 생성자가 있으면 전부 이동으로 채워진다. [2.7](#/move-semantics)에서 38MB 버퍼 기준으로 잰 것처럼 복사와 이동의 비용 차이는 자릿수 단위로 벌어지므로, **재할당 한 번의 실제 비용은 원소 타입에 이동 생성자가 있느냐 없느냐에 따라 완전히 다른 세계에 있다.**

::: warn noexcept를 빼먹으면 이동 생성자를 만들어 놓고도 못 쓴다
이동 생성자를 선언했더라도 `noexcept`가 빠져 있으면 `vector`는 재할당 시 그 이동 생성자를 쓰지 않고 복사로 돌아간다 — [2.7](#/move-semantics)의 `perf` 상자에서 이미 실측했다. 강한 예외 보장을 지켜야 하는 재할당 입장에서는, 실패할 수도 있는 이동보다 실패해도 원본을 온전히 남기는 복사가 더 안전한 선택이기 때문이다. 이동 생성자를 쓰고 `noexcept`를 빼먹는 실수는 컴파일 에러 없이 조용히 성능만 깎아 먹는다.
:::

::: interview "vector에 push_back할 때 재할당이 일어나면 내부적으로 무슨 일이 일어나는가"
`vector` 내부 구조 질문에서 가장 흔한 형태다. 답변 뼈대: ① `vector`는 원소가 아니라 버퍼를 가리키는 포인터 세 개(`begin`, `end`, `end_of_storage`)만 들고 있고, `size()`는 `end - begin`, `capacity()`는 `end_of_storage - begin`이다. ② `size() == capacity()`인 상태에서 원소를 하나 더 넣으면, 대개 두 배 크기의 새 버퍼를 할당하고 기존 원소를 전부 그리로 옮긴 뒤 옛 버퍼를 해제한다(이 절 실측: g++ libstdc++ 기준 정확히 2배, 표준이 강제하는 배율은 아니다). ③ 기존 원소를 옮길 때 이동 생성자가 있고 `noexcept`면 이동을, 아니면 복사를 쓴다 — 이 절 실측으로 20개 원소 재할당에서 복사 31회 대 이동 31회로 정확히 갈렸다. ④ 그래서 재할당은 다른 `push_back` 호출보다 몇 자릿수 느릴 수 있고(이 절 실측: 25ns 대 1.33ms), 이게 `reserve()`로 미리 공간을 확보하라는 조언의 근거다.
:::

## reserve로 재할당을 미리 없앤다

최종 원소 개수를 미리 안다면 `reserve(n)`으로 그만큼의 공간을 한 번에 확보해 재할당 자체를 없앨 수 있다. `reserve`는 `capacity`만 키울 뿐 `size`나 원소 내용은 건드리지 않는다. 5백만 개를 채우는 루프를 `reserve` 유무로 나눠 실측한다.

```cpp title="reserve_timing.cpp — reserve 유무에 따른 push_back 5,000,000회 시간"
#include <chrono>
#include <iostream>
#include <vector>

constexpr int N = 5'000'000;
constexpr int REPEAT = 20;

double time_no_reserve() {
    auto t0 = std::chrono::steady_clock::now();
    for (int r = 0; r < REPEAT; ++r) {
        std::vector<int> v;              // capacity 0에서 시작 -- 재할당이 반복된다
        for (int i = 0; i < N; ++i) v.push_back(i);
    }
    auto t1 = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(t1 - t0).count();
}

double time_with_reserve() {
    auto t0 = std::chrono::steady_clock::now();
    for (int r = 0; r < REPEAT; ++r) {
        std::vector<int> v;
        v.reserve(N);                    // 재할당 횟수를 0으로 만든다
        for (int i = 0; i < N; ++i) v.push_back(i);
    }
    auto t1 = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(t1 - t0).count();
}

int main() {
    double a = time_no_reserve();
    double b = time_with_reserve();
    std::cout << "reserve 없음: 1회 평균 " << a / REPEAT << " ms\n";
    std::cout << "reserve 있음: 1회 평균 " << b / REPEAT << " ms\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 reserve_timing.cpp -o reserve_timing
$ ./reserve_timing
reserve 없음: 1회 평균 42.5864 ms
reserve 있음: 1회 평균 13.1435 ms
```

(g++ 13.3 / `-O2` / Linux x86-64 실측, 세 번 반복 실행에서 reserve 없음은 41.7~47.8ms, reserve 있음은 13.1~13.5ms 사이로 흔들렸다.) `reserve`를 미리 부르는 쪽이 약 **3배 이상 빠르다.** 두 루프가 하는 일(정수 5백만 개를 채워 넣는 것) 자체는 똑같은데, 차이는 오직 재할당 횟수뿐이다 — `reserve` 없이는 capacity가 1부터 시작해 23번쯤 두 배씩 커지며 그때마다 기존 원소를 복사하지만(`int`는 이동 생성자 개념 자체가 없는 원시 타입이라 항상 `memcpy`급 복사다), `reserve(N)` 후에는 그 복사가 단 한 번도 일어나지 않는다.

## 반복자·포인터·레퍼런스 무효화 예고

재할당이 버퍼를 통째로 새 자리로 옮긴다는 사실은 옛 버퍼를 가리키던 것들에 직접적인 대가를 물린다. 원소를 가리키던 포인터·레퍼런스·반복자는 재할당이 일어나는 순간 전부 옛(이미 해제된) 버퍼를 가리키는 채로 남는다.

```cpp title="iter_invalidate_preview.cpp — push_back 한 번이 앞서 떠 둔 포인터를 무효화한다"
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v(4, 0);
    v.shrink_to_fit();          // capacity를 정확히 4로 고정한다

    int* p = &v[0];              // 첫 원소를 가리키는 포인터를 미리 떠 둔다

    v.push_back(99);            // capacity 초과 -- 재할당, 옛 버퍼는 delete[]된다

    std::cout << *p << "\n";    // 이미 해제된 버퍼를 읽는다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g iter_invalidate_preview.cpp -o iter_invalidate_preview
$ ./iter_invalidate_preview
==20543==ERROR: AddressSanitizer: heap-use-after-free on address 0x502000000010 at pc ...
READ of size 4 at 0x502000000010 thread T0
    #0 ... in main iter_invalidate_preview.cpp:14
freed by thread T0 here:
    ...
    #5 ... in std::vector<int, std::allocator<int> >::_M_realloc_insert<int>(...) /usr/include/c++/13/bits/vector.tcc:519
    #6 ... in std::vector<int, std::allocator<int> >::push_back(int&&) /usr/include/c++/13/bits/stl_vector.h:1299
    #7 ... in main iter_invalidate_preview.cpp:12
SUMMARY: AddressSanitizer: heap-use-after-free ... in main
```

(g++ 13.3 / ASan 실측 — 스택 트레이스는 핵심만 남기고 축약했다.) `p`가 가리키던 자리는 `push_back(99)`가 재할당을 일으키며 `delete[]`된 옛 버퍼 안이었고, 그다음 줄에서 `*p`로 읽는 순간 `heap-use-after-free`가 그 자리에서 잡힌다. 이 절에서는 재할당이 무효화를 만들 수 있다는 것만 확인해 둔다 — **capacity가 남아 있는 `push_back`은 무효화를 안 만드는지, `insert`·`erase`는 무효화 범위가 어떻게 다른지, `end()` 반복자 자체는 언제 무효화되는지** 같은 정확한 규칙표는 [5.4 반복자와 무효화 규칙](#/iterators)에서 전 컨테이너를 통틀어 정리한다.

::: note vector\<bool\>은 이 절의 구조를 따르지 않는다
[4.7](#/type-deduction)에서 다룬 `std::vector<bool>`은 비트 하나로 값을 압축 저장하는 특수화라서, 이 절에서 본 "포인터 3개 + 연속된 `T` 배열"이라는 일반적인 `vector<T>` 구조를 그대로 따르지 않는다. `operator[]`가 `bool&`가 아니라 프록시 객체를 돌려주는 이유가 정확히 이 비트 압축 때문이다 — 4.7절의 ASan 실측이 그 대가를 이미 보여줬다. 이 절의 성장 전략·재할당 비용 논의는 `vector<bool>`을 제외한 나머지 모든 `vector<T>`에 그대로 적용된다.
:::

## 로보틱스 도메인: 실시간 제어 루프에서 재할당이 만드는 지연 스파이크

이 절 첫머리에서 잰 25ns 대 1.33ms의 격차를 로봇 제어 루프 위에 그대로 옮겨 보면 문제의 크기가 분명해진다. 헥사포드처럼 1ms 주기로 도는 제어 루프 안에서 센서 값을 담는 `vector`가 매 주기 자라나야 하는 구조라면, 대부분의 주기는 문제없이 끝나다가 재할당이 걸리는 특정 주기 하나가 주기 예산(1ms) 자체를 넘겨 버릴 수 있다. 평균 실행 시간만 보면 이 위험은 완전히 가려진다 — 문제는 평균이 아니라 **최악의 경우(worst-case)가 예측 불가능한 순간에 튄다는 것**이다. 이 절은 그 스파이크가 왜 생기는지(성장 전략과 재할당 비용)까지만 다룬다. 그 스파이크를 실시간 제어 루프에서 애초에 어떻게 없애는지(제어 루프 진입 전 `reserve`로 상한을 미리 확보하는 것, 나아가 힙 할당 자체를 아예 피하는 설계)는 [6.8 실시간 제약과 제어 루프](#/realtime)에서 본격적으로 다룬다.

## 요약

- `std::vector<T>`는 원소를 직접 들고 있지 않다 — 힙에 있는 원소 버퍼를 가리키는 포인터 세 개(`begin`, `end`, `end_of_storage`)만 가지고, 객체 자체의 크기는 24바이트(x86-64 실측)로 고정이다.
- `size()`는 실제 채워진 원소 수(`end - begin`), `capacity()`는 재할당 없이 더 넣을 수 있는 한계(`end_of_storage - begin`)다 — 항상 `capacity() >= size()`다.
- capacity가 바닥나면 재할당이 일어난다 — g++ libstdc++는 매번 정확히 **두 배**로 키운다(실측: 1→2→4→8→16→32→64). 이 배율은 표준이 강제하지 않는 구현별 선택이다.
- 재할당이 기존 원소를 옮길 때, 이동 생성자가 있고 `noexcept`면 이동을, 아니면 복사를 쓴다(실측: 20개 원소 재할당에서 복사 31회 대 이동 31회로 정확히 갈렸다) — [2.7 이동 시맨틱](#/move-semantics)의 규칙이 그대로 적용된다.
- `reserve(n)`으로 최종 크기를 미리 확보하면 재할당 자체가 사라진다 — 실측으로 5백만 개 채우기가 약 3배 이상 빨라졌다(42.6ms → 13.1ms).
- 재할당은 그 순간 옛 버퍼를 가리키던 포인터·레퍼런스·반복자를 전부 무효화한다(실측: ASan `heap-use-after-free`) — 정확한 무효화 규칙표는 [5.4](#/iterators)에서 다룬다.
- 재할당의 25ns 대 1.33ms급 시간 격차는 실시간 제어 루프에서 예측 불가능한 지연 스파이크로 나타난다 — [6.8 실시간 제약](#/realtime)에서 이어진다.

::: quiz 연습문제
1~3번은 개념·예측 문제, 4~5번은 네 컴퓨터에서 직접 코드를 짜고 실행해서 확인하는 실습이다.

1. `capacity()`와 `size()`를 각각 한 문장으로 정의하고, `capacity() > size()`인 상태가 왜 안전한지 설명하라(힌트: `end_`와 `end_of_storage_` 사이의 메모리 상태).

2. 이 절의 `growth_factor.cpp` 실측에서 capacity가 1→2→4→8→...로 두 배씩 뛰었다. 이 배율이 C++ 표준이 강제하는 값인지 아닌지 밝히고, 그렇게 판단한 근거를 이 절의 문장에서 찾아 써라.

3. (예측) `reloc_copyonly.cpp`의 `LoudCopyOnly`에 `noexcept` 없는 이동 생성자만 추가하면(즉 이동 생성자는 있지만 `noexcept`가 빠진 채) 재할당 시 `copy_count`와 `move_count`가 각각 어떻게 나올지 예측하라. [2.7](#/move-semantics)의 `noexcept` 규칙과 연결해 근거를 먼저 써라.

4. (실습, 코드 작성형) `reloc_copyonly.cpp`를 그대로 타이핑하고, `emplace_back` 횟수를 20번에서 200번으로 늘려 실행하라. 성공 기준: 재할당이 일어나는 capacity 시퀀스(1,2,4,...,256)를 직접 계산해 그 합을 예상한 값과, 실제로 찍힌 `copy_count`가 일치함을 확인한다.

5. (실습) `reserve_timing.cpp`를 그대로 타이핑하고, `N`을 5,000,000에서 20,000,000으로 늘려 다시 실행하라. 성공 기준: `reserve` 유무의 시간 배율이 이 절의 실측(약 3배 안팎)과 비슷한 수준으로 네 컴퓨터에서도 재현되는지 직접 확인했다.
:::

::: answer 해설
1. `size()`는 지금 실제로 채워진 원소의 개수, `capacity()`는 재할당 없이 더 넣을 수 있는 버퍼 전체의 크기다. `end_`와 `end_of_storage_` 사이는 이미 `vector`가 할당해 배타적으로 소유한 메모리이지만 아직 원소 생성자가 불리지 않은 raw storage라서, 그 공간에 새 원소를 지어 넣는 것만으로 `push_back`이 안전하게 끝난다 — 남는 공간이 있다고 다른 코드가 침범하는 게 아니다.
2. 표준이 강제하는 값이 아니다. 본문의 "이 배율(growth factor)은 libstdc++의 선택이지 표준의 강제가 아니다 — 다른 표준 라이브러리 구현은 다른 배율을 고를 수 있고, 그 경우에도 여전히 분할 상환 $O(n)$이라는 표준의 요구는 만족한다"는 문장이 근거다.
3. `noexcept`가 빠지면 `vector`는 강한 예외 보장을 지키기 위해 이동 생성자가 있어도 쓰지 않고 복사로 돌아간다 — 그래서 `copy_count`는 31에 가깝게, `move_count`는 0에 가깝게 나올 것으로 예측된다. [2.7](#/move-semantics)에서 이미 이 규칙을 `vector_moves.cpp`로 실측했다.
4. capacity는 1,2,4,8,16,32,64,128,256으로 여덟 번 재할당되고, 그때마다 옮겨진 기존 원소 수의 합은 1+2+4+8+16+32+64+128=255다. `emplace_back`은 신규 원소를 그 자리에서 바로 생성하므로 `copy_count`는 정확히 255가 나와야 한다.
5. `reserve`의 이득은 재할당 횟수를 0으로 만드는 데서 오고, 이 이득은 원소 개수 `N`의 크기와 무관하게 비슷한 비율로 유지된다 — `N`을 4배로 늘려도 두 시간 모두 대략 4배씩 늘어나되 그 비율(약 3배 안팎)은 크게 안 변하는 것이 정상이다. 다른 배율이 나온다면 캐시·메모리 대역폭 등 다른 요인이 섞였을 가능성을 의심해라([8.2 캐시와 메모리 레이아웃](#/cache) 참고).
:::

이 절의 `push_jitter.cpp`, `growth_factor.cpp`, `sizeof_vector.cpp`, `reloc_copyonly.cpp`, `reloc_nomove.cpp`, `reserve_timing.cpp`를 전부 직접 타이핑해라. `iter_invalidate_preview.cpp`는 `-fsanitize=address -g`를 붙여서 돌려 ASan 리포트를 두 눈으로 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra -O2 main.cpp -o main && ./main`.

**다음 절**: [5.2 map, set, unordered_map](#/assoc-containers) — `vector`가 왜 연속된 배열로 원소를 담는지 봤으니, 이번엔 정렬된 트리(레드블랙 트리)와 해시 테이블이라는 완전히 다른 내부 구조를 가진 컨테이너로 넘어간다. 재할당 대신 노드 단위 할당이 만드는 비용을 같은 방식으로 실측한다.
