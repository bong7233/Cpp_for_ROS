# 4.7 auto, decltype, 타입 추론 규칙

::: lead
[2.3 레퍼런스](#/references)에서 이미 부딪혔다 — `auto copy = original;`은 복사 생성자를 부르고, `auto&`와 `const auto&`는 아무것도 안 찍는다는 걸 로그만으로 실측했다. 그런데 그 절은 "레퍼런스가 벗겨진다"는 결과만 보여줬을 뿐, `auto`가 정확히 무엇을 벗기고 남기는지, 그 규칙이 어디서 오는지는 다루지 않았다. [4.6](#/constexpr)이 "값"이 언제 확정되는지를 다뤘다면, 이번 절은 "타입"이 언제, 어떤 규칙으로 확정되는지를 다룬다. `auto`, `decltype`, `decltype(auto)`, `auto&&` — 넷은 겉보기엔 비슷하지만 완전히 다른 규칙으로 타입을 뽑아낸다. 이 차이를 모르면 벡터의 `operator[]`가 돌려주는 게 진짜 `bool&`인 줄 알고 조용히 틀린 값을 읽거나, Eigen 연산 결과를 `auto`로 받았다가 존재하지 않는 메모리를 읽는 코드를 만든다.
:::

## 2.3이 남긴 질문: auto는 정확히 무엇을 벗기는가

[2.3](#/references)의 실측을 다시 떠올려 보자. `Counted` 객체 하나를 두고 `auto copy = original;`, `auto& ref = original;`, `const auto& cref = original;` 세 줄을 나란히 실행했을 때, 복사 생성자 로그는 첫 줄에서만 찍혔다. 이 결과에서 알 수 있는 건 딱 하나다 — "`auto`는 복사를 만들고, `auto&`와 `const auto&`는 안 만든다." 그런데 원본이 이미 `const`면 `auto&`는 그 `const`를 유지하는가, 함수가 레퍼런스를 반환할 때 `auto`로 받으면 그 레퍼런스가 유지되는가 같은 질문에는 아직 답이 없다.

이 질문들이 단순한 호기심이 아닌 이유가 있다. `std::vector<bool>::operator[]`처럼 겉보기엔 평범한데 실제로는 진짜 값이 아니라 프록시 객체를 돌려주는 함수가 표준 라이브러리 곳곳에 있고, `auto`로 그 결과를 받는 순간 무엇을 손에 쥐었는지 착각하기 쉽다. 이 절은 그 착각을 실측으로 걷어낸다.

## auto의 추론 규칙: 템플릿 인자 추론과 사실상 같다

`auto`가 타입을 뽑아내는 규칙은 새로 발명된 게 아니다. **함수 템플릿의 인자 타입 추론 규칙을 거의 그대로 가져다 쓴다.** `auto x = expr;`은 마치 `template <typename T> void f(T x); f(expr);`을 호출했을 때 `T`가 무엇으로 추론되는지와 같은 절차를 밟는다 — `auto`가 곧 그 자리의 `T`다. 이 규칙의 핵심은 하나다: **값으로 받는 자리(`T`, 즉 `auto`)는 인자의 레퍼런스 자격과 최상위 `const`/`volatile`을 벗긴다.** 반면 `T&`(즉 `auto&`) 자리는 레퍼런스만 씌울 뿐 원본의 `const`는 그대로 존중해야 하므로, 원본이 `const`면 추론된 `T` 자체가 `const`를 포함하게 된다.

이걸 `std::is_same_v`로 눈에 보이는 사실로 바꾼다. 컴파일이 통과한다는 것 자체가 타입이 정확히 그것이라는 증거다 — `static_assert`가 틀렸다면 그 자리에서 컴파일이 막힌다.

```cpp title="auto_rules.cpp — const 원본을 auto, auto&, const auto&로 각각 받는다"
#include <iostream>
#include <type_traits>

int main() {
    const int cx = 42;   // 원본이 const라는 점이 핵심이다

    auto a = cx;          // 값 복사 -- const도, 레퍼런스 자격도 벗긴다
    auto& b = cx;         // 레퍼런스는 유지하되, 원본이 const라 const를 못 벗긴다
    const auto& c = cx;   // 애초에 const를 요구했다

    static_assert(std::is_same_v<decltype(a), int>,       "a는 int여야 한다");
    static_assert(std::is_same_v<decltype(b), const int&>, "b는 const int&여야 한다");
    static_assert(std::is_same_v<decltype(c), const int&>, "c는 const int&여야 한다");

    std::cout << "static_assert 3개 전부 통과\n";
    std::cout << "a=" << a << " b=" << b << " c=" << c << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra auto_rules.cpp -o auto_rules
$ ./auto_rules
static_assert 3개 전부 통과
a=42 b=42 c=42
```

(g++ 13.3 실측.) `a`는 `int`다 — `cx`가 `const`였지만 값으로 복사하는 자리라 `const`가 벗겨졌다. `b`는 `const int&`다 — `auto&`가 레퍼런스 자격은 유지하지만, `cx` 자체가 `const int`이므로 그 레퍼런스는 `const`를 뺄 수 없다(뺐다면 `const` 객체를 `non-const` 레퍼런스로 가리키는 규칙 위반이 된다). `c`는 애초에 `const auto&`라고 못박았으니 당연히 `const int&`다. 원본이 `non-const`인 `int x`였다면 `auto a = x`는 그대로 `int`, `auto& b = x`는 `int&`가 된다 — 결론은 하나다: **`auto`는 항상 `const`와 레퍼런스를 벗기고, `auto&`는 레퍼런스만 씌우되 원본의 `const`는 못 벗긴다.**

::: deep 정확히는 "최상위" const만 벗긴다
`auto`가 벗기는 건 **최상위(top-level) `const`**뿐이다. `const int* p`를 `auto q = p;`로 받으면 `q`는 여전히 `const int*`다 — 포인터가 가리키는 대상의 `const`는 값의 일부이지, "`q` 자신을 못 바꾼다"는 최상위 속성이 아니기 때문이다. 포인터·레퍼런스 뒤에 숨은 `const`는 이 절의 규칙과 무관하게 그대로 남는다.
:::

## auto의 함정 ①: 프록시 타입을 가린다 — std::vector\<bool\>

`auto`가 벗기는 게 레퍼런스와 최상위 `const`뿐이라는 걸 알아도, 함정은 다른 데서 온다 — **원본 타입 자체가 생각과 다를 때**다. `std::vector<bool>`은 비트 하나로 값을 압축 저장하려고, `operator[]`가 진짜 `bool&`가 아니라 **프록시 객체**(`std::vector<bool>::reference`)를 돌려준다.

```cpp title="vecbool_proxy.cpp — auto가 무엇을 추론했는지 확인한다"
#include <iostream>
#include <type_traits>
#include <vector>

int main() {
    std::vector<bool> flags(3, false);

    auto elem = flags[0];   // auto가 무엇을 추론했는지가 이 절의 질문이다

    static_assert(!std::is_same_v<decltype(elem), bool>);
    static_assert(std::is_same_v<decltype(elem), std::vector<bool>::reference>);

    std::cout << "elem의 타입은 bool이 아니라 std::vector<bool>::reference다\n";

    elem = true;   // "복사본이니 안전하다"는 감각으로 대입했다
    std::cout << "flags[0] = " << flags[0] << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra vecbool_proxy.cpp -o vecbool_proxy
$ ./vecbool_proxy
elem의 타입은 bool이 아니라 std::vector<bool>::reference다
flags[0] = 1
```

(g++ 13.3 실측.) `auto`가 `bool`을 추론했을 거라는 예상과 다르게, 실제로는 `std::vector<bool>::reference`라는 프록시 클래스가 나왔다. 더 위험한 건 그다음 줄이다 — `elem = true`는 "복사본이니 원본에 영향이 없을 것"이라는 [2.3](#/references)식 직관과 반대로 **`flags[0]`을 실제로 바꾼다.** 프록시가 내부적으로 원본 비트 버퍼를 가리키는 포인터를 들고 있어서다. 이 프록시가 붙잡은 버퍼가 재할당되면 상태는 댕글링으로 바뀐다.

```cpp title="vecbool_dangle.cpp — 프록시가 재할당된 버퍼를 계속 참조한다"
#include <iostream>
#include <vector>

int main() {
    std::vector<bool> flags(4, false);
    flags.shrink_to_fit();               // capacity를 정확히 4로 고정한다

    auto proxy = flags[0];               // 프록시가 지금 capacity=4인 내부 버퍼를 가리킨다

    for (int i = 0; i < 100; ++i) {
        flags.push_back(true);           // capacity 초과 -- 내부 버퍼가 재할당된다
    }

    proxy = true;                        // 이미 해제된 옛 버퍼에 쓰려고 시도한다
    std::cout << "done\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g vecbool_dangle.cpp -o vecbool_dangle
$ ./vecbool_dangle
==18422==ERROR: AddressSanitizer: heap-use-after-free on address 0x502000000010 at pc ...
READ of size 8 at 0x502000000010 thread T0
    #0 ... in std::_Bit_reference::operator=(bool) /usr/include/c++/13/bits/stl_bvector.h:107
    #1 ... in main vecbool_dangle.cpp:14
...
freed by thread T0 here:
    #5 ... in std::vector<bool, std::allocator<bool> >::_M_insert_aux(...) /usr/include/c++/13/bits/vector.tcc:949
    #6 ... in std::vector<bool, std::allocator<bool> >::push_back(bool) /usr/include/c++/13/bits/stl_bvector.h:1160
SUMMARY: AddressSanitizer: heap-use-after-free ... in std::_Bit_reference::operator=(bool)
```

(g++ 13.3 / ASan 실측 — 전체 스택 트레이스는 축약했다.) `push_back` 100번이 내부 버퍼를 재할당했고, `proxy`가 붙잡고 있던 옛 버퍼는 이미 해제됐다. `proxy = true`는 그 해제된 메모리에 쓰기를 시도해 `heap-use-after-free`로 그 자리에서 잡힌다. **`auto`가 아니라 반드시 `bool`로 명시해서 받아라** — `bool value = flags[0];`이었다면 프록시가 즉시 실제 `bool` 값으로 변환되어 버퍼와의 연결이 끊기므로 이 문제 자체가 생기지 않는다.

::: danger vector\<bool\>은 컨테이너가 아니라 예외다
표준위원회 스스로도 `std::vector<bool>`의 특수화를 실수로 인정한다 — 자세한 내부 구조는 [5.1 vector](#/vector)에서 다룬다. 이 절에서 기억할 규칙은 하나다: **`vector<bool>`의 원소는 `auto` 대신 반드시 `bool`을 명시하라.** 이 규칙 하나가 방금 본 heap-use-after-free를 막는다.
:::

## auto의 함정 ②: 큰 객체를 복사해 버린다

두 번째 함정은 새롭지 않다 — [2.3](#/references)에서 이미 벤치마크로 확인한 문제를 `auto`의 관점에서 다시 짚는다. `auto`가 값을 복사한다는 규칙은 원시 타입에는 공짜지만 `std::string`이나 큰 구조체에는 그렇지 않다. [2.3](#/references)의 `rangefor_string.cpp`가 `for (auto s : names)`를 `for (const auto& s : names)`보다 약 6배 느리게 만든 원인이 정확히 이 규칙이다 — `auto s`는 컨테이너 원소가 `const std::string&`이었든 상관없이 그 자격을 벗기고 매 반복 힙 할당·복사를 만든다. **원칙은 그대로다 — 읽기만 한다면 `const auto&`, 원소가 원시 타입 하나뿐일 때만 `auto`를 예외로 허용한다.**

## decltype: 벗기지 않고 그대로 보존한다

`auto`가 항상 무언가를 벗긴다면, `decltype`은 정반대다. `decltype(expr)`은 표현식의 타입을 **있는 그대로**, 레퍼런스와 `const`까지 포함해서 돌려준다. 게다가 `decltype`에는 `auto`에 없는 규칙이 하나 더 있다 — **괄호를 하나 더 치면 결과가 바뀐다.**

```cpp title="decltype_exact.cpp — decltype(x)와 decltype((x))는 다른 타입을 낸다"
#include <iostream>
#include <type_traits>

int main() {
    int x = 10;

    auto a = x;                // auto: 레퍼런스 자격을 벗긴다
    decltype(x) d1 = x;        // decltype(엔티티): 선언된 타입 그대로 -- int
    decltype((x)) d2 = x;      // decltype(괄호 친 표현식): 값 범주까지 본다 -- lvalue라 int&

    static_assert(std::is_same_v<decltype(a), int>);
    static_assert(std::is_same_v<decltype(d1), int>);
    static_assert(std::is_same_v<decltype(d2), int&>);   // 괄호 하나가 타입을 바꿨다

    d2 = 99;   // d2는 진짜 레퍼런스라 x 자신이 바뀐다
    std::cout << "x = " << x << " (d2 대입 후)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra decltype_exact.cpp -o decltype_exact
$ ./decltype_exact
x = 99 (d2 대입 후)
```

(g++ 13.3 실측.) `decltype(x)`는 `x`라는 **이름(엔티티)** 그 자체를 본다 — `x`는 `int`로 선언됐으니 결과도 `int`다. `decltype((x))`는 괄호로 감싸서 `x`를 이름이 아니라 **표현식**으로 취급한다 — `x`라는 표현식은 값을 바꿀 수 있는 lvalue이므로 `decltype`은 `T&`(여기선 `int&`)를 돌려준다. `d2 = 99;`로 원본 `x`가 실제로 바뀐 것이 그 증거다.

::: warn decltype(x)와 decltype((x))를 착각하면 반환 타입이 조용히 바뀐다
템플릿 코드에서 `decltype(expr)`을 반환 타입에 쓸 때, 괄호를 하나 더 쳤는지 여부로 함수가 값을 반환하는지 레퍼런스를 반환하는지가 갈린다. 의도한 게 아니라면 컴파일 에러도 없이 조용히 다른 동작을 만드는, 눈에 잘 안 띄는 실수다.
:::

## decltype(auto): 함수 반환에서 값 범주를 그대로 지킨다 (C++14)

일반 `auto`로 함수 반환 타입을 선언하면, 반환식이 레퍼런스를 반환하는 함수 호출이어도 `auto`의 규칙대로 레퍼런스가 벗겨진다. **`decltype(auto)`는 이 벗김을 막는다** — 반환식에 그대로 `decltype`의 규칙을 적용해 값 범주를 지킨다.

```cpp title="decltype_auto_return.cpp — auto와 decltype(auto)가 같은 함수 호출을 다르게 반환한다"
#include <iostream>
#include <type_traits>

int g_counter = 0;

int& get_ref() { return g_counter; }

auto get_by_value() { return get_ref(); }         // auto: 반환 타입에서도 레퍼런스를 벗긴다 -- int
decltype(auto) get_by_ref() { return get_ref(); } // decltype(auto): 반환식의 값 범주 그대로 -- int&

int main() {
    static_assert(std::is_same_v<decltype(get_by_value()), int>);
    static_assert(std::is_same_v<decltype(get_by_ref()), int&>);

    g_counter = 0;
    int copy = get_by_value();  // 복사본을 받는다 -- 애초에 대입할 좌변이 못 된다(아래 참고)
    copy = 999;
    std::cout << "copy=" << copy << "로 바꿔도 g_counter = " << g_counter << "\n";

    get_by_ref() = 100;        // 진짜 레퍼런스를 돌려받았으니 원본이 바뀐다
    std::cout << "get_by_ref 대입 후 g_counter = " << g_counter << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra decltype_auto_return.cpp -o decltype_auto_return
$ ./decltype_auto_return
copy=999로 바꿔도 g_counter = 0
get_by_ref 대입 후 g_counter = 100
```

(g++ 13.3 실측.) `get_by_value()`가 돌려준 건 `g_counter`의 복사본이라, `copy`를 아무리 바꿔도 원본 `g_counter`는 `0`에 머문다. 반면 `get_by_ref()`는 `decltype(auto)` 덕분에 진짜 `int&`를 그대로 돌려받았고, `= 100`을 대입하니 `g_counter`가 실제로 `100`이 됐다. 두 함수 본문은 `return get_ref();`로 똑같은데 반환 타입 선언만으로 동작이 갈린다. `get_by_value()`가 진짜 값(prvalue)이라는 사실은 다음 코드로도 확인된다.

```cpp title="auto_return_assign_fail.cpp — auto 반환값은 대입할 좌변이 못 된다"
int g_counter = 0;
int& get_ref() { return g_counter; }
auto get_by_value() { return get_ref(); }   // auto 반환 -- 레퍼런스가 벗겨져 int(prvalue)가 나온다

int main() {
    get_by_value() = 100;   // 좌변이 lvalue가 아니다 -- 애초에 대입 문법 자체가 성립 안 한다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra auto_return_assign_fail.cpp -o auto_return_assign_fail
auto_return_assign_fail.cpp:6:17: error: lvalue required as left operand of assignment
    6 |     get_by_value() = 100;   // 좌변이 lvalue가 아니다 -- 애초에 대입 문법 자체가 성립 안 한다
      |     ~~~~~~~~~~~~^~
```

(g++ 13.3 실측.) 컴파일러가 "좌변이 lvalue가 아니다"라고 거부한 것 자체가 `auto`가 레퍼런스를 완전히 벗겨서 순수한 값(prvalue)만 남겼다는 증거다.

::: hist decltype(auto)는 C++14에 왜 추가됐나
C++11의 함수 반환 타입 추론은 `auto`뿐이었고, 레퍼런스를 그대로 돌려주는 래퍼 함수를 짜려면 `decltype(expr)`을 반환 타입 자리에 직접 손으로 적어야 했다(후행 반환 타입 `-> decltype(expr)`이 그 흔적이다). C++14는 "반환문의 표현식에 `decltype`의 규칙을 그대로 적용하라"는 `decltype(auto)`로 이 손코딩을 없앴다 — [4.4](#/variadic-templates)의 `std::forward` 완벽 전달 래퍼 함수에서 특히 유용하다.
:::

## auto&&: 포워딩 레퍼런스를 auto 문맥에서 다시 본다

[4.4 가변 인자 템플릿](#/variadic-templates)에서 `Args&&... args`가 템플릿 파라미터가 추론되는 자리에서만 lvalue·rvalue를 둘 다 받는 **전달 레퍼런스(forwarding reference)**로 동작한다는 걸 봤다. 이 규칙은 템플릿 파라미터 `T&&`에만 국한되지 않는다 — **`auto&&`도 똑같은 규칙을 따른다.** `auto` 역시 그 자리에서 타입이 추론되기 때문이다.

```cpp title="auto_fwdref.cpp — auto&&는 lvalue와 rvalue를 둘 다 받는다"
#include <iostream>
#include <type_traits>

int main() {
    int x = 10;

    auto&& a = x;    // x는 lvalue -- auto는 int&로 추론되고 auto&&는 int& & 축소 -> int&
    auto&& b = 20;   // 20은 rvalue -- auto는 int로 추론되고 auto&&는 int&& 그대로

    static_assert(std::is_same_v<decltype(a), int&>);
    static_assert(std::is_same_v<decltype(b), int&&>);

    std::cout << "a=" << a << " b=" << b << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra auto_fwdref.cpp -o auto_fwdref
$ ./auto_fwdref
a=10 b=20
```

(g++ 13.3 실측.) lvalue `x`를 바인딩할 때는 `auto`가 `int&`로 추론되고, 레퍼런스 축소 규칙(`& &` → `&`)에 따라 `auto&&`는 결국 `int&`가 된다. rvalue `20`을 바인딩할 때는 `auto`가 `int`로 추론되고 `auto&&`는 그대로 `int&&`다. `auto&`(비`const` 레퍼런스)는 rvalue를 절대 못 받는다는 걸 [2.3](#/references)에서 이미 봤다 — `auto&&`는 이 제약이 없는 유일한 `auto` 조합이다.

이 성질이 실전에서 가장 자주 쓰이는 자리가 [1.5](#/control-flow)에서 본 범위 기반 for다. `const auto&`가 안전한 기본값이라고 했지만, **원소를 수정도 해야 하고 복사도 절대 피하고 싶다면** `auto&&`가 정답이다.

```cpp title="rangefor_autoref.cpp — auto&&는 복사도 이동도 만들지 않는다"
#include <iostream>
#include <vector>

struct Loud {
    Loud()                   { std::cout << "  기본 생성자\n"; }
    Loud(const Loud&)         { std::cout << "  복사 생성자\n"; }
    Loud(Loud&&) noexcept     { std::cout << "  이동 생성자\n"; }
};

int main() {
    std::vector<Loud> v(3);   // 여기서 기본 생성자 3번

    std::cout << "-- for (auto&& x : v) --\n";
    for (auto&& x : v) {
        (void)x;               // 복사/이동 로그가 하나도 안 찍혀야 한다
    }
    std::cout << "-- 루프 끝 --\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra rangefor_autoref.cpp -o rangefor_autoref
$ ./rangefor_autoref
  기본 생성자
  기본 생성자
  기본 생성자
-- for (auto&& x : v) --
-- 루프 끝 --
```

(g++ 13.3 실측.) `기본 생성자` 세 줄은 `v`를 만들 때 찍힌 것이고, 루프 구간에는 복사도 이동도 안 찍힌다 — `auto&&`가 매 반복마다 순수한 별명 바인딩만 했다는 뜻이다. `auto&&`가 진가를 발휘하는 자리는 원소가 앞서 본 `vector<bool>`의 프록시처럼 **매 반복마다 임시 객체(rvalue)를 만드는 컨테이너**일 때다. `auto&`로는 이런 rvalue 원소를 아예 못 받는데, `auto&&`는 문제없이 받는다.

```cpp title="rangefor_vecbool.cpp — 매 반복 rvalue 프록시가 나와도 auto&&는 바인딩된다"
#include <iostream>
#include <vector>

int main() {
    std::vector<bool> flags(3, false);

    for (auto&& b : flags) {   // vector<bool>::iterator::operator*는 프록시(rvalue)를 돌려준다
        b = true;               // auto&&는 이 rvalue 프록시에도 바인딩에 성공한다
    }

    for (bool b : flags) std::cout << b << " ";
    std::cout << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra rangefor_vecbool.cpp -o rangefor_vecbool
$ ./rangefor_vecbool
1 1 1
```

(g++ 13.3 실측.) `flags`의 세 원소가 전부 `true`로 바뀌었다 — `vector<bool>`의 이터레이터가 매 반복마다 만들어 내는 프록시 rvalue에 `auto&&`가 정확히 바인딩됐고, 그 프록시를 통한 대입이 원본 비트 버퍼에 그대로 반영됐다. **범위 기반 for에서 "원소를 수정해야 하고, 원소 타입이 프록시일 수도 있다"는 상황이면 `auto&`가 아니라 `auto&&`가 안전한 기본값이다.**

::: interview "auto와 decltype의 차이, auto&&가 뭔지 설명하라"
타입 추론 관련 면접에서 가장 흔한 조합 질문이다.

**auto vs decltype**: `auto`는 템플릿 인자 추론과 같은 규칙으로 레퍼런스와 최상위 `const`를 벗기고 값 타입만 남긴다(`auto_rules.cpp` 실측). `decltype(expr)`은 정반대로 표현식의 타입을 레퍼런스까지 포함해 그대로 보존하고, `decltype(x)`(이름)와 `decltype((x))`(괄호 친 표현식)는 서로 다른 타입을 낸다(`decltype_exact.cpp` 실측). 함수 반환 타입에서 이 차이를 쓰고 싶으면 C++14의 `decltype(auto)`를 쓴다.

**auto&&**: 템플릿 파라미터가 추론되는 자리의 `T&&`([4.4](#/variadic-templates)의 전달 레퍼런스)와 같은 규칙을 따르는, 템플릿이 아닌 문맥의 전달 레퍼런스다. lvalue엔 `T&`로, rvalue엔 `T&&`로 축소된다 — 그래서 lvalue·rvalue를 둘 다 받는 유일한 `auto` 조합이다. 범위 기반 for에서 `vector<bool>`처럼 매 반복 rvalue 프록시를 낳는 원소는 `auto&`로 못 받지만 `auto&&`는 받는다(`rangefor_vecbool.cpp` 실측).
:::

## 함수 반환 타입 추론 (C++14): 여러 return의 타입이 안 맞으면 그 자리에서 에러

`decltype(auto)`와 별개로, C++14부터는 평범한 `auto`도 함수 반환 타입 자리에 직접 쓸 수 있다 — `auto func() { ... }` 형태로 선언부에 반환 타입을 아예 안 적어도 된다. 컴파일러는 함수 본문의 `return`문들을 보고 타입을 추론하는데, **여러 `return`문의 타입이 서로 다르면 첫 번째로 나온 타입과 어긋나는 순간 에러**다.

```cpp title="auto_return_mismatch.cpp — 두 번째 return의 타입이 첫 번째와 다르면 막힌다"
auto pick(bool cond) {
    if (cond) {
        return 1;      // int로 추론을 시작한다
    } else {
        return 2.0;    // 여기서 double이 나온다 -- 앞과 타입이 다르다
    }
}

int main() {
    return pick(true);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra auto_return_mismatch.cpp -o auto_return_mismatch
auto_return_mismatch.cpp:5:16: error: inconsistent deduction for auto return type: 'int' and then 'double'
    5 |         return 2.0;    // 여기서 double이 나온다 -- 앞과 타입이 다르다
      |                ^~~~
```

(g++ 13.3 실측.) `inconsistent deduction for auto return type: 'int' and then 'double'` — 컴파일러가 정확히 어느 지점에서 타입이 어긋났는지 짚어 준다. 조건에 따라 다른 타입을 반환하는 실수를 런타임까지 안 가고 컴파일 단계에서 잡아 준다.

## auto 사용의 원칙과 로봇 도메인 연결

지금까지 본 규칙을 이 책의 실전 관례로 정리한다.

- **타입이 장황하거나 자명할 때는 `auto`를 적극 쓴다.** 반복자나 람다의 타입([5.6 람다](#/lambdas)의 클로저 타입은 이름조차 없다)이 대표적이다.
- **함수 시그니처(인터페이스 경계)에서는 명시적 타입을 우선한다.** 반환 타입 추론은 구현을 숨기고 싶은 내부 헬퍼에나 쓰고, 공개 API에는 웬만하면 안 쓴다.
- **범위 기반 for는 `const auto&`가 기본값, 수정이 필요하면 `auto&`, 원소가 매 반복 임시 프록시를 낳을 수 있으면 `auto&&`.**
- **`std::vector<bool>`의 원소는 `auto`가 아니라 `bool`로 명시한다.** 이 절에서 실측한 ASan `heap-use-after-free`가 그 근거다.

[2.3](#/references)이 예고했던 마지막 함정을 이 절에서 완결한다 — **Eigen의 표현식 템플릿과 `auto`의 조합이다.** `A * B` 같은 Eigen 연산은 결과 행렬이 아니라 계산이 안 끝난 **표현식 객체**를 돌려준다([9.1 Eigen](#/eigen)에서 이 설계의 이유를 다룬다). `auto`로 받으면 "auto는 항상 안전한 복사"라는 이 절의 직관이 정확히 뒤집힌다.

```cpp title="eigen_auto_trap3.cpp — auto가 지역 변수를 참조하는 표현식을 그대로 붙잡는다"
#include <Eigen/Dense>
#include <iostream>

auto make_expr(Eigen::VectorXd a, Eigen::VectorXd b) {   // 값으로 받는다 -- a, b는 이 함수의 지역 변수다
    return a + b;    // auto 반환 -- a, b를 참조하는 "미계산 표현식"을 돌려준다
}

int main() {
    Eigen::VectorXd x(3); x << 1, 2, 3;
    Eigen::VectorXd y(3); y << 10, 20, 30;

    auto expr = make_expr(x, y);   // make_expr의 지역 변수 a, b는 이미 소멸했다
    std::cout << expr.transpose() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g -I/usr/include/eigen3 eigen_auto_trap3.cpp -o eigen_auto_trap3
$ ./eigen_auto_trap3
==23891==ERROR: AddressSanitizer: stack-use-after-scope on address 0x7ff01ab00140 ...
READ of size 8 at 0x7ff01ab00140 thread T0
    #0 ... in Eigen::DenseStorage<double, -1, -1, 1, 0>::data() const .../DenseStorage.h:646
    ...
    #18 ... in main eigen_auto_trap3.cpp:13
Address 0x7ff01ab00140 is located in stack of thread T0 at offset 320 in frame
    #0 ... in main eigen_auto_trap3.cpp:8
  This frame has 16 object(s):
    ...
    [256, 272) 'x' (line 9)
    [288, 304) 'y' (line 10)
    [320, 336) '<unknown>' <== Memory access at offset 320 is inside this variable
    ...
    [384, 408) 'expr' (line 12)
SUMMARY: AddressSanitizer: stack-use-after-scope ... in Eigen::DenseStorage<...>::data() const
```

(g++ 13.3 / Eigen 3.4 / ASan 실측 — 스택 트레이스는 핵심만 남기고 축약했다.) `make_expr` 안의 `a`, `b`는 함수가 끝나는 순간 스택에서 사라진다. `a + b`가 돌려준 표현식 객체(`Eigen::CwiseBinaryOp`)는 `a`, `b`를 값이 아니라 **참조**로 붙잡고 있어서, `auto expr = make_expr(x, y);`로 받은 `expr`은 이미 죽은 스택 프레임을 참조하는 채로 `main`에 돌아온다. `expr.transpose()`로 값을 실제로 읽는 순간 `stack-use-after-scope`가 터진다. ASan 프레임 덤프의 `offset 320`이 `x`(line 9)·`y`(line 10) 바로 다음, `expr`(line 12) 바로 전의 이름 없는 객체로 잡히는데, 이게 `make_expr` 호출이 남긴 흔적이다. **Eigen 표현식은 `auto`가 아니라 명시적으로 `Eigen::VectorXd` 같은 결과 타입으로 받아 그 자리에서 즉시 평가를 강제하거나, `.eval()`을 명시적으로 불러야 한다.**

이 함정과 별개로 [10.2 토픽: publisher와 subscription](#/pub-sub)에서 볼 rclcpp 구독 콜백 람다에서는 `auto`가 관례로 잘 쓰인다 — 람다의 반환 타입이나 반복자 타입처럼 이름 쓰기가 번거로운 자리다. 다만 콜백의 **파라미터 타입**(메시지 타입)은 인터페이스 경계이므로 이 절의 원칙대로 명시적으로 적는다.

## 요약

- `auto`는 함수 템플릿의 인자 추론과 같은 규칙을 쓴다 — 레퍼런스와 최상위 `const`를 벗기고 값 타입만 남긴다(실측: `auto_rules.cpp`). `auto&`는 레퍼런스는 씌우되 원본의 `const`는 못 벗긴다.
- `std::vector<bool>::operator[]`은 `bool&`가 아니라 프록시 객체를 돌려준다 — `auto`로 받으면 타입을 착각하고, 그 프록시가 재할당된 버퍼를 참조하면 `heap-use-after-free`가 난다(ASan 실측).
- `decltype(expr)`은 벗기지 않고 표현식 타입을 그대로 보존한다 — `decltype(x)`(이름)와 `decltype((x))`(괄호 친 표현식)는 서로 다른 타입을 낸다(실측: 후자만 진짜 레퍼런스).
- `decltype(auto)`(C++14)는 함수 반환 타입에서 `auto`가 벗기는 레퍼런스를 그대로 지킨다 — 같은 반환문이 `auto`로는 값을, `decltype(auto)`로는 레퍼런스를 만든다(실측).
- `auto&&`는 템플릿이 아닌 문맥에서도 전달 레퍼런스와 같은 규칙을 따른다 — lvalue엔 `T&`로, rvalue엔 `T&&`로 축소된다(실측). 범위 기반 for에서 수정이 필요하고 원소가 프록시일 수도 있으면 `auto&&`가 안전한 기본값이다.
- `auto` 함수 반환 타입 추론(C++14)은 여러 `return`문의 타입이 어긋나면 그 자리에서 컴파일 에러를 낸다(실측).
- Eigen의 표현식 템플릿을 `auto`로 받으면 소멸된 지역 변수를 참조로 붙잡는다 — 값으로 받은 로컬 벡터의 합을 `auto`로 반환하면 `stack-use-after-scope`가 재현된다(ASan 실측). Eigen 결과는 `auto` 대신 명시적 타입으로 받아 즉시 평가시킨다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일해서 확인하는 실습이다.

1. `const int cx = 42; auto& b = cx;`에서 `b`의 타입은 무엇인가? `auto`가 `const`를 벗기는 규칙과 왜 모순되지 않는지 설명하라.

2. `decltype(x)`와 `decltype((x))`가 다른 타입을 내는 이유를 한 문장으로 요약하라. `decltype(auto)`가 함수 반환 타입에 유용한 이유와 엮어서 설명하라.

3. (실습, 코드 작성형) `decltype_exact.cpp`를 그대로 타이핑하고, `d2 = 99;` 줄을 지운 뒤 `decltype((x))` 대신 `decltype(x)`로 바꿔서 `d1 = 99;`를 추가해 보라. 성공 기준: `g++ -std=c++20 -Wall -Wextra`로 컴파일은 통과하지만 `d1`을 바꿔도 `x`는 그대로임을 `std::cout`으로 확인한다(값이 바뀌지 않아야 정상이다).

4. (실습) `vecbool_dangle.cpp`를 그대로 타이핑하고 `g++ -std=c++20 -fsanitize=address -g` 로 컴파일해 실행하라. 성공 기준: `heap-use-after-free` 리포트가 뜨고, 그 안에서 `push_back`이 재할당을 일으킨 지점(`_M_insert_aux`)과 `proxy = true;`가 접근한 지점(`_Bit_reference::operator=`)을 각각 스택 트레이스에서 찾아낸다.

5. (실습) `auto pick(bool cond) { if (cond) return 1; else return 2.0; }`를 직접 타이핑해서 에러를 재현하라. 그다음 두 번째 `return`을 `return 2;`로 바꿔서 같은 함수가 통과하는 것을 확인하라. 성공 기준: 수정 전 `inconsistent deduction` 에러와 수정 후 정상 컴파일 둘 다 네 눈으로 봤다.
:::

::: answer 해설
1. `b`의 타입은 `const int&`다. `auto`(값 자리)만 최상위 `const`를 벗긴다. `auto&`는 `T&` 자리라서 원본이 `const`면 `T` 자체가 `const int`로 추론돼야 `b`가 `cx`를 올바르게 참조한다 — 모순이 아니라 다른 규칙이 적용된 것이다.
2. `decltype(x)`는 이름(엔티티)의 선언된 타입을 그대로 돌려주지만, `decltype((x))`는 표현식으로 취급해 값 범주(lvalue면 `T&`)까지 반영한다. `decltype(auto)`는 함수의 `return`문에 이 규칙을 그대로 적용해, 반환식이 레퍼런스면 함수도 레퍼런스를 반환한다 — 일반 `auto`라면 벗겨져 항상 값이 된다.
3. `decltype(x) d1 = x;`로 받은 `d1`은 `int`(값)라 `d1 = 99;`를 해도 `x`는 그대로다 — 이름을 본 것이라 레퍼런스가 아니기 때문이다. `decltype((x))`로 받은 `d2`가 `x`를 실제로 바꿨던 것과 대비하면 괄호의 효과가 분명해진다.
4. ASan 리포트의 `freed by thread T0 here` 구간에서 `push_back(bool)`·`_M_insert_aux`가 재할당 지점이고, `READ of size 8 ...` 아래 `_Bit_reference::operator=(bool)`과 `main`의 `proxy = true;` 줄이 해제된 메모리에 재접근한 지점이다.
5. 첫 `return 1;`이 반환 타입을 `int`로 확정한 뒤 `return 2.0;`이 `double`이라 `inconsistent deduction` 에러가 뜬다. `return 2.0;`을 `return 2;`로 고치면 둘 다 `int`로 일치해 정상 컴파일된다.
:::

이 절의 `auto_rules.cpp`, `decltype_exact.cpp`, `decltype_auto_return.cpp`, `auto_fwdref.cpp`, `rangefor_autoref.cpp`를 전부 직접 타이핑해라. `vecbool_dangle.cpp`와 `eigen_auto_trap3.cpp`는 `-fsanitize=address -g`를 붙여서 돌려 ASan 리포트를 두 눈으로 확인해라 — Eigen 예제는 `-I/usr/include/eigen3`를 잊지 마라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra 파일.cpp -o 이름 && ./이름`이다.

**다음 절**: [5.1 vector: 내부 구조와 성장 전략](#/vector) — Part IV에서 "타입을 어떻게 다루는가"를 다졌으니, Part V는 "그 타입을 어떤 자료구조에 담는가"로 넘어간다. 이 절에서 잠깐 스친 `std::vector<bool>`의 프록시 문제를, `vector` 전체의 성장 전략과 재할당 규칙 안에서 다시 제대로 다룬다.
