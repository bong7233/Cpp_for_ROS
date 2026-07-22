# 5.8 string_view와 span

::: lead
[1.7](#/arrays-strings) 끝에서 숙제를 하나 남겨 뒀다 — 함수가 문자열을 읽기만 할 때 `const std::string&`으로 받으면, 호출자가 리터럴이나 `substr()` 결과를 넘기는 순간 임시 `std::string`이 하나 생긴다는 것. 이 절은 그 숙제부터 실측으로 정산한 뒤, 같은 문제가 컨테이너 전반에도 있다는 걸 보여준다 — `vector`든 `array`든 C 배열이든, 그 값을 읽기만 할 함수는 원소 타입과 개수만 알면 되는데 시그니처는 컨테이너 종류마다 따로 짜야 했다. `std::string_view`(C++17)와 `std::span`(C++20)은 둘 다 같은 재료 — **포인터 하나, 길이 하나** — 로 이 두 문제를 정확히 해결한다. 대신 그 재료가 "소유하지 않는다"는 사실이 만드는 함정도 있다. 실측으로 이득과 함정을 둘 다 본다.
:::

## const string&가 정말 공짜인가 — 실측으로 확인한다

"참조로 받았으니 복사가 없다"는 말은 호출자가 이미 `std::string`을 들고 있을 때만 옳다. 리터럴을 넘기거나, `substr()`로 부분 문자열을 만들거나, 함수가 새로 만든 문자열을 반환하는 경우는 셋 다 참조가 가리킬 **임시 `std::string`**을 그 자리에서 새로 만들어야 한다. `operator new`를 가로채 힙 할당 횟수를 직접 세 본다.

```cpp title="temp_const_string.cpp — const string& 파라미터가 만드는 임시 객체"
#include <iostream>
#include <string>

int ctor_count = 0;
void* operator new(std::size_t sz) {   // 전역 operator new를 가로채 할당 횟수를 센다
    ++ctor_count;
    return std::malloc(sz);
}

void handle(const std::string& frame_name) {
    std::cout << "  받은 이름: " << frame_name << "\n";
}

std::string make_child_frame(const std::string& parent, int leg) {
    return parent + "/leg_" + std::to_string(leg) + "/tibia_link";
}

int main() {
    ctor_count = 0;
    std::cout << "1) 리터럴을 넘긴다\n";
    handle("leg_front_left/tibia_link");           // 25자, SSO 경계(15) 넘음
    std::cout << "   heap alloc = " << ctor_count << "\n\n";

    std::string full = "odom/base_link/leg_front_left/tibia_link";
    ctor_count = 0;
    std::cout << "2) substr() 결과를 넘긴다\n";
    handle(full.substr(5));
    std::cout << "   heap alloc = " << ctor_count << "\n\n";

    ctor_count = 0;
    std::cout << "3) 함수가 만든 임시 string을 그대로 넘긴다\n";
    handle(make_child_frame("odom", 2));
    std::cout << "   heap alloc = " << ctor_count << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 temp_const_string.cpp -o temp_const_string
$ ./temp_const_string
1) 리터럴을 넘긴다
  받은 이름: leg_front_left/tibia_link
   heap alloc = 1

2) substr() 결과를 넘긴다
  받은 이름: base_link/leg_front_left/tibia_link
   heap alloc = 1

3) 함수가 만든 임시 string을 그대로 넘긴다
  받은 이름: odom/leg_2/tibia_link
   heap alloc = 1
```

(g++ 13.3 / `-O2` / Linux x86-64 실측.) 세 경우 모두 힙 할당이 정확히 **1회씩** 찍혔다 — 참조 전달 자체는 공짜지만, 참조가 가리킬 대상을 만드는 쪽에서 [1.7](#/arrays-strings)의 SSO 경계(15자)를 넘는 임시 `std::string`을 매번 새로 짓는다. `handle`은 문자열을 읽기만 하는데도, 호출부마다 생성자·소멸자·(경우에 따라) 힙 할당까지 딸려 온다. 함수 내부에서 문자열을 수정하거나 저장할 게 아니라면 이 비용은 순전히 낭비다.

## string_view: 포인터와 길이만 든 뷰

`std::string_view`는 위 문제를 만드는 근본 원인 — "함수가 `std::string` 타입 자체를 요구한다" — 을 없앤다. `handle`의 파라미터 타입만 바꿔서 같은 세 케이스를 다시 재 본다.

```cpp title="view_no_alloc.cpp — 파라미터 타입만 string_view로 바꾼다"
#include <iostream>
#include <string>
#include <string_view>

int ctor_count = 0;
void* operator new(std::size_t sz) { ++ctor_count; return std::malloc(sz); }

void handle(std::string_view frame_name) {          // 유일하게 바뀐 줄
    std::cout << "  받은 이름: " << frame_name << "\n";
}

int main() {
    ctor_count = 0;
    handle("leg_front_left/tibia_link");
    std::cout << "1) 리터럴      heap alloc = " << ctor_count << "\n";

    std::string full = "odom/base_link/leg_front_left/tibia_link";
    ctor_count = 0;
    handle(full);
    std::cout << "2) string 자체 heap alloc = " << ctor_count << "\n";

    ctor_count = 0;
    handle(std::string_view(full).substr(5));        // 뷰의 substr은 복사하지 않는다
    std::cout << "3) view의 substr heap alloc = " << ctor_count << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 view_no_alloc.cpp -o view_no_alloc
$ ./view_no_alloc
1) 리터럴      heap alloc = 0
2) string 자체 heap alloc = 0
3) view의 substr heap alloc = 0
```

(g++ 13.3 / `-O2` 실측.) 세 경우 모두 힙 할당이 **0회**다. 이유는 `string_view`가 문자열을 복사해 담는 게 아니라 원본 어딘가를 가리키는 **포인터 + 길이** 한 쌍만 들고 있기 때문이다 — 리터럴이면 리터럴이 이미 놓여 있는 읽기 전용 영역을, `std::string`이면 그 버퍼를, `substr()`이면 원본 버퍼의 부분 구간을 그대로 가리킨다. `std::string_view::substr()`가 `std::string::substr()`와 이름은 같지만 하는 일은 완전히 다르다는 게 여기서 드러난다 — 뷰의 `substr`은 새 버퍼를 만드는 대신 포인터를 옮기고 길이를 줄이기만 한다.

이 가벼움을 `sizeof`로 확인한다.

```cpp title="sizeof_view.cpp — string_view는 문자열 길이와 무관하게 크기가 고정이다"
#include <iostream>
#include <string_view>

int main() {
    std::cout << "sizeof(std::string_view) = " << sizeof(std::string_view) << " bytes\n";
    std::string_view a = "x";
    std::string_view b = "leg_front_left/tibia_link/some/very/long/nested/frame/name/that/keeps/going";
    std::cout << "sizeof(a), a.size()=" << a.size() << "  ->  " << sizeof(a) << " bytes\n";
    std::cout << "sizeof(b), b.size()=" << b.size() << "  ->  " << sizeof(b) << " bytes\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sizeof_view.cpp -o sizeof_view
$ ./sizeof_view
sizeof(std::string_view) = 16 bytes
sizeof(a), a.size()=1  ->  16 bytes
sizeof(b), b.size()=75  ->  16 bytes
```

(g++ 13.3 / x86-64 실측.) 1자짜리든 75자짜리든 `string_view` 객체 자체는 **16바이트**(포인터 8 + `size_t` 8) 그대로다. [1.7](#/arrays-strings)의 `std::string`(32바이트, ptr/size/capacity)보다도 작고, 문자열 데이터를 전혀 소유하지 않으므로 소멸자도 할 일이 없다 — 복사 비용은 포인터와 정수 하나를 복사하는 것과 같다.

## string_view의 댕글링 함정

"소유하지 않는다"는 이득의 반대편 얼굴이다. `string_view`는 원본이 살아 있는 동안만 유효하다 — 원본이 없어지면 뷰는 아무것도 가리키지 않는 게 아니라, **이미 해제된 메모리를 계속 가리킨다.** 두 가지 흔한 패턴으로 직접 만들어 본다.

```cpp title="dangling1.cpp — 함수가 반환한 임시 string을 뷰로 받는다"
#include <iostream>
#include <string>
#include <string_view>

std::string load_frame_name() {
    return std::string("leg_front_left/tibia_link");   // 매번 새 string을 만들어 반환
}

int main() {
    std::string_view sv = load_frame_name();   // 임시 string을 뷰가 "본다"
    // load_frame_name()이 반환한 임시 객체는 이 문장이 끝나는 순간 소멸한다.
    // sv는 그 소멸한 버퍼를 가리키는 댕글링 뷰로 남는다.
    std::cout << "sv = " << sv << "\n";        // 이미 해제된 메모리를 읽는다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address dangling1.cpp -o dangling1
$ ./dangling1
==30940==ERROR: AddressSanitizer: heap-use-after-free on address 0x503000000040 ...
READ of size 25 at 0x503000000040 thread T0
    #0 ... in main dangling1.cpp:14
freed by thread T0 here:
    ... in std::__cxx11::basic_string<...>::~basic_string() /usr/include/c++/13/bits/basic_string.h:804
    #7 ... in main dangling1.cpp:11
previously allocated by thread T0 here:
    ... in load_frame_name[abi:cxx11]() dangling1.cpp:7
SUMMARY: AddressSanitizer: heap-use-after-free ... in main
```

(g++ 13.3 / ASan 실측, 스택 트레이스는 핵심만 남겼다.) `load_frame_name()`이 만든 임시 `std::string`은 `sv`를 초기화하는 문장이 끝나는 순간 소멸했고(11번 줄에서 `free`됨), 그다음 줄에서 `sv`를 읽자 ASan이 그 자리에서 `heap-use-after-free`를 잡았다. **`string_view`는 참조 대상의 수명을 늘려주지 않는다** — 레퍼런스도 마찬가지지만, `const std::string&`이었다면 애초에 참조 자체는 안전했을 자리(임시 객체의 수명이 그 표현식이 끝날 때까지로 정해져 있으므로)에서도 뷰로 "저장"하는 순간 함정이 된다.

두 번째 패턴은 스코프를 벗어난 뒤에도 뷰를 계속 쓰는 경우다.

```cpp title="dangling2.cpp — 지역 문자열이 사라진 뒤에도 뷰를 계속 쓴다"
#include <iostream>
#include <string>
#include <string_view>

std::string_view g_saved_view;   // 어딘가의 멤버 변수라고 생각하라

void remember(const std::string& s) {
    g_saved_view = s;    // s가 가리키는 버퍼를 그대로 가리키는 뷰를 저장한다
}

int main() {
    {
        std::string local_frame = "leg_front_left/tibia_link";
        remember(local_frame);
        std::cout << "스코프 안: " << g_saved_view << "\n";
    }   // local_frame이 여기서 소멸 -- 버퍼가 해제된다
    std::cout << "스코프 밖: " << g_saved_view << "\n";  // 이미 해제된 버퍼를 읽는다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address dangling2.cpp -o dangling2
$ ./dangling2
스코프 안: leg_front_left/tibia_link
==32021==ERROR: AddressSanitizer: heap-use-after-free on address 0x503000000040 ...
READ of size 25 at 0x503000000040 thread T0
    #0 ... in main dangling2.cpp:18
freed by thread T0 here:
    ... in std::__cxx11::basic_string<...>::~basic_string() /usr/include/c++/13/bits/basic_string.h:804
    #7 ... in main dangling2.cpp:16
SUMMARY: AddressSanitizer: heap-use-after-free ... in main
```

(g++ 13.3 / ASan 실측.) 스코프 안에서는 `g_saved_view`가 정상 출력됐지만, `local_frame`이 소멸하는 순간(16번 줄) 뷰가 가리키던 버퍼가 해제됐고, 스코프 밖에서 읽자마자 `heap-use-after-free`가 잡혔다. 두 실측을 합치면 규칙은 하나로 좁혀진다 — **`string_view`는 함수 파라미터로만 써라. 멤버 변수나 전역 변수에 저장하려는 순간, 그 뷰보다 원본이 더 오래 살아남는지부터 증명해야 한다.**

::: danger 이 실측이 함정이 아니라 결과를 보여준 이유
두 프로그램 다 컴파일 경고 없이 통과했다. `string_view`의 댕글링은 타입 시스템이 막아 주지 않는다 — [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 다룬 포인터·레퍼런스의 댕글링과 완전히 같은 성격의 문제이고, 잡는 도구도 같다(ASan). `string_view`를 리턴 타입이나 멤버로 쓸 때는 반드시 원본의 수명을 먼저 확인하고, 조금이라도 의심되면 ASan 빌드로 한 번 돌려라.
:::

## span: 배열의 decay 문제를 뷰로 해결한다

[1.7](#/arrays-strings)에서 C 배열이 함수 경계를 넘으면 크기를 잃는다는 걸 봤고, [5.1 vector](#/vector)에서는 `vector`가 원소를 힙 버퍼로 관리한다는 걸 봤다. 이 둘을 나란히 놓으면 질문이 하나 생긴다 — 관절 각도를 합산하는 함수가 있는데, 호출자가 `vector<double>`을 쓰든 `array<double, 6>`을 쓰든 그냥 C 배열을 쓰든 함수 입장에서는 상관이 없다면, 함수 시그니처를 왜 세 벌로 나눠 써야 하나. `std::span`(C++20)은 정확히 이 자리를 채운다 — "연속으로 놓인 원소들의 시작 주소 + 개수"만 있으면 되는 함수는 컨테이너 종류를 몰라도 된다.

```cpp title="span_unify.cpp — 하나의 시그니처로 vector/array/C배열을 전부 받는다"
#include <array>
#include <iostream>
#include <numeric>
#include <span>
#include <vector>

double sum_joint_angles(std::span<const double> angles) {
    return std::accumulate(angles.begin(), angles.end(), 0.0);
}

int main() {
    std::vector<double> from_vector = {0.1, 0.2, 0.3, 0.4, 0.5, 0.6};
    std::array<double, 6> from_array = {0.1, 0.2, 0.3, 0.4, 0.5, 0.6};
    double from_c_array[6] = {0.1, 0.2, 0.3, 0.4, 0.5, 0.6};

    std::cout << "vector 로 넘김   : " << sum_joint_angles(from_vector) << "\n";
    std::cout << "array 로 넘김    : " << sum_joint_angles(from_array) << "\n";
    std::cout << "C 배열로 넘김    : " << sum_joint_angles(from_c_array) << "\n";
    std::cout << "부분 span(앞 3개): "
               << sum_joint_angles(std::span(from_vector).first(3)) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra span_unify.cpp -o span_unify
$ ./span_unify
vector 로 넘김   : 2.1
array 로 넘김    : 2.1
C 배열로 넘김    : 2.1
부분 span(앞 3개): 0.6
```

(g++ 13.3 실측.) `sum_joint_angles`는 딱 한 벌만 짰는데 세 가지 컨테이너를 전부 받았고, 복사는 한 번도 없다 — `std::span`의 생성자가 각 컨테이너의 시작 주소와 원소 개수를 뽑아 16바이트짜리 뷰 하나로 감쌌을 뿐이다. `first(3)`처럼 부분 구간만 넘기는 것도 `string_view::substr()`와 같은 원리로 복사 없이 된다.

```cpp title="sizeof_span.cpp — 동적 extent와 정적 extent의 크기 차이"
#include <array>
#include <iostream>
#include <span>
#include <vector>

int main() {
    std::vector<double> v(1000, 0.0);
    std::array<double, 6> a{};
    std::span<double> sv(v);        // 크기를 런타임에 아는 뷰 (동적 extent)
    std::span<double, 6> sa(a);     // 크기가 타입에 있는 뷰 (정적 extent, [1.7]의 array와 같은 발상)

    std::cout << "sizeof(span<double>)    동적 extent = " << sizeof(sv) << " bytes,  size()=" << sv.size() << "\n";
    std::cout << "sizeof(span<double,6>)  정적 extent = " << sizeof(sa) << " bytes,  size()=" << sa.size() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sizeof_span.cpp -o sizeof_span
$ ./sizeof_span
sizeof(span<double>)    동적 extent = 16 bytes,  size()=1000
sizeof(span<double,6>)  정적 extent = 8 bytes,  size()=6
```

(g++ 13.3 실측.) 원소 개수를 템플릿 인자로 고정한 `span<double, 6>`은 `size_t` 필드 자체가 필요 없어 **8바이트**(포인터 하나) — [1.7](#/arrays-strings)에서 `std::array`가 크기를 타입에 새겨 오버헤드 0을 만든 것과 정확히 같은 원리다. 크기를 런타임에만 아는 일반 `span<double>`은 `string_view`와 같은 16바이트다.

::: deep 왜 span은 string_view보다 늦게(C++20) 나왔는가
`string_view`는 C++17에, `span`은 C++20에 들어왔다. 둘의 발상은 같은데도 3년 차이가 난 이유는 `span`이 다뤄야 할 문제가 더 넓기 때문이다 — `string_view`는 원소 타입이 `char` 하나로 고정이라 특수화 하나만 표준화하면 끝이지만, `span<T>`는 임의의 원소 타입 `T`에 더해 크기를 컴파일 타임에 고정할지(`span<T, N>`) 런타임에 결정할지(`span<T>`, `N = std::dynamic_extent`)까지 하나의 클래스 템플릿으로 통일해야 했다. 위 실측에서 본 8바이트 대 16바이트 차이가 이 설계의 결과물이다.
:::

## span도 무효화된다 — vector의 재할당 규칙이 그대로 적용된다

`span`도 소유하지 않는 뷰이므로 원본이 사라지면 댕글링이 되는 건 `string_view`와 같다. 그런데 로봇 코드에서 더 자주 만나는 함정은 원본이 아예 사라지는 게 아니라 **원본이 `vector`이고, 그 `vector`가 재할당되는** 경우다. [5.1 vector](#/vector)에서 `push_back`이 capacity를 넘기면 버퍼를 통째로 새 자리로 옮기고 옛 버퍼를 해제한다는 걸 실측했다 — `span`이 그 옛 버퍼를 가리키고 있었다면 이 재할당이 그대로 댕글링을 만든다.

```cpp title="span_dangle.cpp — vector 재할당이 span을 무효화한다"
#include <iostream>
#include <span>
#include <vector>

int main() {
    std::vector<int> readings;
    readings.reserve(4);
    readings = {1, 2, 3, 4};        // capacity 4로 채운다

    std::span<int> view(readings);  // vector 버퍼를 가리키는 뷰
    std::cout << "재할당 전 view[0] = " << view[0] << "\n";

    readings.push_back(5);   // capacity 초과 -- vector가 재할당, 옛 버퍼는 delete[]된다
    // view는 여전히 옛 버퍼를 가리킨 채로 남는다 -- span은 재할당을 알 방법이 없다.

    std::cout << "재할당 후 view[0] = " << view[0] << "\n";  // 이미 해제된 버퍼를 읽는다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address span_dangle.cpp -o span_dangle
$ ./span_dangle
재할당 전 view[0] = 1
==674==ERROR: AddressSanitizer: heap-use-after-free on address 0x502000000010 ...
READ of size 4 at 0x502000000010 thread T0
    #0 ... in main span_dangle.cpp:16
freed by thread T0 here:
    ... in std::vector<int, std::allocator<int> >::_M_realloc_insert<int>(...) /usr/include/c++/13/bits/vector.tcc:519
    #6 ... in std::vector<int, std::allocator<int> >::push_back(int&&) ...
    #8 ... in main span_dangle.cpp:13
SUMMARY: AddressSanitizer: heap-use-after-free ... in main
```

(g++ 13.3 / ASan 실측.) 재할당 전에는 `view[0]`이 정상적으로 1을 냈지만, `push_back(5)`가 `_M_realloc_insert`(5.1절에서 이미 본 그 함수)를 거쳐 재할당을 일으키자 `view`는 이미 `delete[]`된 옛 버퍼를 가리킨 채 남았고, 다음 읽기에서 곧바로 `heap-use-after-free`가 잡혔다. [5.4 반복자와 무효화 규칙](#/iterators)에서 다루는 반복자·포인터·레퍼런스 무효화 규칙이 `span`에도 예외 없이 적용된다는 뜻이다 — `span`은 겉보기엔 새 타입이지만 무효화 관점에서는 그저 "포인터 하나를 들고 다니는 것"과 다르지 않다.

::: interview string_view/span을 언제 함수 매개변수로 쓰는가
"`const std::string&` 대신 `string_view`를 언제 쓰냐"는 STL 설계 이해도를 보는 질문이다. 답변 뼈대: ① 함수가 문자열을 **읽기만** 하고 저장하지 않을 때 — 저장이 필요하면 `string`으로 복사해 소유권을 가져야 한다(뷰를 멤버로 두면 원본 수명 관리 책임이 호출자에게 넘어간다). ② 호출자가 리터럴·`substr()`·다른 라이브러리의 반환값 등 `std::string` 타입이 아닌 것을 자주 넘길 때 — 이 절 실측대로 `const string&`는 그때마다 임시 객체와 힙 할당을 만들지만 `string_view`는 0회다. ③ `span`은 같은 논리를 컨테이너로 확장한 것 — `vector`/`array`/C 배열을 가리지 않고 연속 메모리를 읽기만 하는 함수에 쓴다. ④ 둘 다 뷰이므로 반환 타입으로 쓸 때, 그리고 멤버·전역에 저장할 때는 원본의 수명이 뷰보다 긴지 반드시 확인해야 한다는 것까지 말하면 함정까지 아는 답이다.
:::

## 값으로 받는 게 관례인 이유

`string_view`도 `span`도 함수 매개변수로 받을 때는 `const&`를 붙이지 않고 **값으로** 받는 게 관례다.

```cpp title="조각: 관례 비교"
void handle(std::string_view name);          // ✅ 값으로 받는다
void handle(const std::string_view& name);   // ❌ 불필요한 간접 참조 한 단계

void process(std::span<const double> data);          // ✅
void process(const std::span<const double>& data);   // ❌
```

이유는 이 절에서 이미 실측했다 — `string_view`와 `span`(동적 extent) 둘 다 딱 16바이트, `int`나 `double` 두 개 얹은 것과 다르지 않은 크기다. [1.6 함수: 오버로딩과 인자 전달](#/functions)에서 다룬 "작은 타입은 값으로, 큰 타입은 `const&`로"라는 기준을 그대로 적용하면 답은 명확하다 — 뷰 자체가 이미 충분히 작다. 여기에 `const&`를 씌우면 얻는 것 없이 포인터의 포인터를 하나 더 만드는 간접 참조만 늘어난다. `std::string`(32바이트, 소유 자원 포함)이나 `std::vector`(24바이트, 소유 자원 포함)를 `const&`로 받는 것과 뷰 타입을 값으로 받는 것은 서로 다른 결론이지만 근거는 하나다 — **복사 비용과 소유권 여부를 보고 정한다.**

::: tip 두 타입을 로봇 코드에 적용하는 자리
ROS 2 노드 코드에서 토픽 이름·파라미터 이름·프레임 이름을 다루는 함수는 대개 문자열을 읽기만 한다 — 그런 함수의 매개변수는 `const std::string&`보다 `std::string_view`가 기본값이어야 한다(단, `rclcpp`의 공개 API 서명 자체는 바꿀 수 없으니 이건 당신이 새로 짜는 유틸리티 함수 기준이다). 반대로 IMU나 라이다에서 들어오는 원시 버퍼 — 예를 들어 `std::vector<uint8_t>`에 담긴 패킷 페이로드 — 를 파싱만 하는 함수는 `std::span<const uint8_t>`로 받으면 복사 없이 그 자리에서 바이트를 읽어 나갈 수 있다. 두 경우 다 공통점은 "이 함수는 소유권이 필요 없다"는 것이고, 그 판단이 서면 뷰 타입이 정답이다.
:::

## 요약

- `const std::string&` 파라미터는 참조 전달 자체는 공짜이지만, 호출자가 리터럴·`substr()`·함수 반환값을 넘길 때마다 그 참조가 가리킬 임시 `std::string`을 새로 만든다 — 실측: 세 경우 모두 힙 할당 1회.
- `std::string_view`(C++17)는 포인터 + 길이만 든 16바이트 뷰다 — 같은 세 경우를 힙 할당 0회로 만든다. 크기는 문자열 길이와 무관하게 항상 16바이트(실측: 1자와 75자 모두 동일).
- `string_view`는 원본을 소유하지 않는다 — 임시 `std::string`의 반환값을 뷰로 받거나(실측 ASan `heap-use-after-free`), 지역 문자열이 스코프를 벗어난 뒤 저장해 둔 뷰를 읽으면(실측 ASan) 댕글링이 된다. 함수 매개변수로만 쓰고, 멤버·전역에 저장할 때는 원본 수명을 먼저 확인해라.
- `std::span`(C++20)은 같은 발상을 컨테이너로 확장한다 — `vector`/`array`/C 배열을 가리지 않고 하나의 함수 시그니처로 받는다(실측: 세 컨테이너 모두 같은 결과). 크기가 타입에 고정된 정적 extent(`span<T, N>`)는 8바이트, 런타임 크기의 동적 extent(`span<T>`)는 16바이트다.
- `span`도 소유하지 않으므로 원본 `vector`가 재할당되면(capacity 초과로 인한 버퍼 이전) 무효화된다 — [5.1 vector](#/vector)의 재할당 무효화 규칙이 그대로 적용된다(실측 ASan `heap-use-after-free`, 발생 지점은 `vector::_M_realloc_insert`).
- 두 타입 모두 "읽기 전용 접근을 위한 저비용 뷰"라서 함수 매개변수로는 `const&`가 아니라 값으로 받는 게 관례다 — 뷰 자체가 이미 포인터 한둘 크기라 참조로 감싸는 게 오히려 손해다.

::: quiz 연습문제
1~2번은 예측·개념 문제, 3번은 설계 판단, 4번은 네 컴퓨터에서 직접 코드를 짜고 ASan으로 확인하는 실습이다.

1. 이 절의 `temp_const_string.cpp`와 `view_no_alloc.cpp` 실측 결과를 근거로, `const std::string&`를 `std::string_view`로 바꾸는 것이 왜 "참조를 값으로 바꾸는 것"이 아니라 "임시 객체 생성 자체를 없애는 것"인지 한 문단으로 설명하라.

2. (예측) 다음 함수가 반환하는 `string_view`를 호출자가 저장했다가 다음 줄에서 출력한다. 컴파일하지 말고 무슨 일이 일어날지 예측하고 근거를 써라.

   ```cpp
   std::string_view first_word(const std::string& s) {
       std::string copy = s;               // 복사본을 만든다
       auto pos = copy.find(' ');
       return std::string_view(copy).substr(0, pos);
   }
   ```

3. `span<const double>`을 매개변수로 받는 함수와, 같은 일을 하는 함수 템플릿(`template<typename Container> void f(const Container&)`)을 비교하라. `span`을 쓰는 쪽이 유리한 지점과, 템플릿을 쓰는 쪽이 유리한 지점을 각각 하나씩 들어라(힌트: 컴파일 시간, 오브젝트 코드 크기, 헤더 의존).

4. (실습, 코드 작성형) IMU 원시 버퍼를 흉내낸 `std::vector<uint8_t> raw(64, 0)`를 만들고, `std::span<const uint8_t>`를 받아 바이트 합을 리턴하는 함수 `checksum(std::span<const uint8_t>)`을 작성해 호출하라. 그다음 `span`을 미리 떠 둔 뒤 원본 `vector`에 `push_back`을 반복해 재할당을 강제로 일으키고, 그 `span`으로 다시 `checksum`을 호출해 보라. 성공 기준: 재할당 전 호출은 정상 값을 내고, 재할당 후 호출은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address`로 빌드했을 때 `heap-use-after-free`가 잡힌다.
:::

::: answer 해설
1. `const std::string&`은 참조라는 전달 방식 자체는 공짜이지만, 그 참조가 가리킬 대상이 없을 때(리터럴, `substr()` 결과, 함수 반환값) 임시 `std::string`을 새로 만들어야 한다 — 그 임시 객체 생성 비용(경우에 따라 힙 할당까지)이 진짜 비용이다. `string_view`로 바꾸면 파라미터가 원본이 이미 어디에 있든(리터럴이 놓인 읽기 전용 영역이든, 기존 `string`의 버퍼든) 그 자리를 포인터+길이로 직접 가리키므로 임시 객체를 만들 필요 자체가 없어진다 — "참조 대신 값"이 아니라 "임시 객체를 만들 이유가 사라진 것"이다.
2. `heap-use-after-free`가 난다. `copy`는 `first_word` 함수의 지역 변수이고, 함수가 반환하면서 소멸한다. 반환하는 `string_view`는 `copy`의 버퍼(길이에 따라 SSO 내장 버퍼일 수도, 힙 버퍼일 수도 있다)를 가리키고 있었을 뿐이므로, 함수가 끝나는 순간 댕글링 뷰가 되어 호출자에게 넘어간다. 이 절의 `dangling1.cpp`와 정확히 같은 패턴이다 — 뷰가 가리키는 원본이 뷰보다 먼저 죽는다.
3. `span`은 함수를 한 번만 컴파일하면 되고(비템플릿이라 헤더에 정의를 둘 필요가 없어 여러 번역 단위에서 호출해도 코드 팽창이 없다), 반면 템플릿 버전은 [4.3 템플릿 인스턴스화의 실체](#/template-mechanics)에서 다룬 대로 호출되는 컨테이너 타입마다 별도 코드가 찍혀 나온다(코드 팽창) — 대신 템플릿 쪽은 `span`으로 감쌀 수 없는 인터페이스(예: 연속 메모리가 아닌 `std::map`이나, `span`이 지원하지 않는 커스텀 반복자 기반 컨테이너)까지 받을 수 있다는 게 강점이다. "연속 메모리 컨테이너만 받으면 된다"가 확실하면 `span`이, "어떤 컨테이너든 반복 가능하면 된다"까지 넓혀야 하면 템플릿이 맞는 선택이다.
4. capacity를 넘는 `push_back`이 [5.1 vector](#/vector)에서 실측한 대로 버퍼를 통째로 새 자리로 옮기고 옛 버퍼를 `delete[]`한다. `span`은 그 이전에 잡아 둔 옛 버퍼의 시작 주소를 그대로 들고 있으므로, 재할당 후의 `checksum` 호출은 이미 해제된 메모리를 읽는 `heap-use-after-free`가 된다 — 이 절의 `span_dangle.cpp`가 정확히 이 시나리오를 보여준다.
:::

이 절의 `temp_const_string.cpp`, `view_no_alloc.cpp`, `sizeof_view.cpp`, `span_unify.cpp`, `sizeof_span.cpp`를 전부 직접 타이핑해라. `dangling1.cpp`, `dangling2.cpp`, `span_dangle.cpp`는 반드시 `-fsanitize=address -g`를 붙여 ASan 리포트를 두 눈으로 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra -O2 main.cpp -o main && ./main`, ASan 버전은 `-O2` 대신 `-g -fsanitize=address`.

**다음 절**: [5.9 optional, variant, expected](#/vocabulary-types) — 값으로 "부재"와 "여러 타입 중 하나"와 "실패"를 표현하는 어휘 타입(vocabulary type)으로 넘어간다.
