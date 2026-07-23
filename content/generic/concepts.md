# 4.5 Concepts (C++20)

::: lead
[4.1](#/function-templates)의 마지막 절은 질문 하나를 남기고 넘어갔다 — `template <typename T, typename U>`처럼 파라미터마다 타입을 따로 받는 템플릿을 설계하면, "T와 U 중 뭘 반환 타입으로 삼을지"와 "애초에 이 템플릿이 아무 타입이나 받아도 되는가"라는 두 문제가 남는다는 것이었다. 이 절은 그중 후자를 정면으로 다룬다. 지금까지 `max_val<T>`는 `T`가 무엇이든 일단 받아들이고, 컴파일러가 본문을 인스턴스화하는 순간에야 `operator>`가 있는지 확인했다. 문제가 생기는 지점이 함수를 호출하는 순간이 아니라 그 안에서 실패하는 순간이라, 에러 메시지는 당신의 코드가 아니라 템플릿 내부 사정을 줄줄이 늘어놓는다. C++20의 concepts는 "이 타입이 뭘 지원해야 하는가"를 함수 시그니처 자체에 못박아, 그 확인을 호출 시점으로 끌어올린다. 실측으로 보면 같은 실패가 158줄짜리 진단에서 16줄짜리 진단으로 줄어든다 — 이 절은 그 차이가 어디서 나오는지를 다룬다.
:::

## 문제: 커스텀 타입 하나가 에러를 통제 불능으로 만든다

[4.1](#/function-templates)의 `max_val`을 그대로 가져온다. `int`, `double`, `std::string`까지는 문제없이 돌았다. 이번엔 관절 하나의 측정값을 담는 커스텀 구조체를 넘겨 본다.

```cpp title="maxval_struct_only.cpp"
template <typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}

struct JointReading {
    double angle;
    double torque;
};

int main() {
    JointReading a{1.2, 3.4};
    JointReading b{2.2, 1.4};
    auto m = max_val(a, b);   // JointReading엔 operator>가 없다
    (void)m;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c maxval_struct_only.cpp -o /dev/null
maxval_struct_only.cpp: In instantiation of 'T max_val(T, T) [with T = JointReading]':
maxval_struct_only.cpp:14:21:   required from here
maxval_struct_only.cpp:3:14: error: no match for 'operator>' (operand types are 'JointReading' and 'JointReading')
    3 |     return a > b ? a : b;
      |            ~~^~~
```

(g++ 13.3 실측.) 이 정도는 봐줄 만하다 — 다섯 줄이 원인을 정확히 짚는다. `JointReading`은 전역 네임스페이스의 평범한 구조체라, 컴파일러가 `operator>` 후보를 찾으러 다닐 곳이 아예 없다. 그런데 실전 로봇 코드는 구조체를 이렇게 맨몸으로 들고 다니지 않는다. 관절 하나가 아니라 한 주기 동안 쌓인 로그 전체를 비교해야 한다면 이렇게 된다.

```cpp title="maxval_vector_err.cpp"
#include <iostream>
#include <vector>

template <typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}

struct JointReading {
    double angle;
    double torque;
};

int main() {
    std::vector<JointReading> a{{1.2, 3.4}};
    std::vector<JointReading> b{{2.2, 1.4}};
    auto m = max_val(a, b);   // 같은 실수, 타입만 vector<JointReading>
    (void)m;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c maxval_vector_err.cpp -o /dev/null
maxval_vector_err.cpp: In instantiation of 'T max_val(T, T) [with T = std::vector<JointReading>]':
maxval_vector_err.cpp:17:21:   required from here
maxval_vector_err.cpp:6:14: error: no match for 'operator>' (operand types are 'std::vector<JointReading>' and 'std::vector<JointReading>')
    6 |     return a > b ? a : b;
      |            ~~^~~
In file included from /usr/include/c++/13/string:48,
                 ...(중략)...
                 from maxval_vector_err.cpp:1:
/usr/include/c++/13/bits/stl_iterator.h:583:5: note: candidate: 'template<class _IteratorL, class _IteratorR>
  requires  three_way_comparable_with<_IteratorR, _IteratorL, std::partial_ordering>
  constexpr std::compare_three_way_result_t<_IteratorL, _IteratorR>
  std::operator<=>(const reverse_iterator<_IteratorL>&, const reverse_iterator<_IteratorR>&)' (reversed)
  583 |     operator<=>(const reverse_iterator<_IteratorL>& __x,
      |     ^~~~~~~~
/usr/include/c++/13/bits/stl_iterator.h:583:5: note:   template argument deduction/substitution failed:
maxval_vector_err.cpp:6:14: note:   'std::vector<JointReading>' is not derived from 'const std::reverse_iterator<_IteratorL>'
    6 |     return a > b ? a : b;
      |            ~~^~~
...(같은 모양의 candidate/실패 쌍이 되풀이된다 — move_iterator, string_view,
     std::basic_string, std::tuple, std::pair, std::vector, std::error_code,
     std::error_condition까지 총 16개 후보)...
/usr/include/c++/13/bits/stl_iterator.h:558:5: note: candidate: 'template<class _IteratorL, class _IteratorR>
  constexpr bool std::operator>(const reverse_iterator<_IteratorL>&, const reverse_iterator<_IteratorR>&)
  requires requires{{std::operator>::__x->base() < std::operator>::__y->base()}
  -> decltype(auto) [requires std::convertible_to<<placeholder>, bool>];}'
  558 |     operator>(const reverse_iterator<_IteratorL>& __x,
      |     ^~~~~~~~
/usr/include/c++/13/bits/stl_iterator.h:558:5: note:   template argument deduction/substitution failed:
maxval_vector_err.cpp:6:14: note:   'std::vector<JointReading>' is not derived from 'const std::reverse_iterator<_IteratorL>'
```

(g++ 13.3 실측, 원본은 158줄에 후보(`note: candidate`)가 정확히 16개다 — 위는 그중 처음과 마지막 후보만 남기고 지면상 줄였고, 원래 한 줄인 긴 후보 시그니처는 지면 폭에 맞춰 여러 줄로 접었다. 실제 터미널에는 줄바꿈 없이 한 줄로 찍힌다.) 근본 원인은 여전히 5번째 줄에 있는 **같은 문장**이다 — `no match for 'operator>'`. 하지만 이번엔 `<iostream>`이 끌고 들어온 `<string>`, `<vector>`, 반복자 어댑터들이 자기 네임스페이스(`std`)에 `operator<=>`나 `operator>`를 하나씩 갖고 있다. C++가 `a > b`를 풀 때 쓰는 인자 종속 탐색(ADL, argument-dependent lookup)은 `a`와 `b`의 타입(`std::vector<JointReading>`)이 속한 네임스페이스 `std` 전체를 뒤진다. `std` 안에는 `operator>`나 `operator<=>` 후보가 여럿 있으니 — reverse_iterator용, move_iterator용, pair용, vector용, error_code/error_condition용 — 컴파일러는 그 하나하나를 붙잡고 "이것도 아니다, 저것도 아니다"를 16번 반복해서 보고한다. **컴파일러는 거짓말을 하지 않는다. 그저 확인한 모든 것을 보고할 뿐이다.** 그 보고서 안에서 진짜 원인(연산자가 아예 없다는 것)과 무관한 소음(16개의 실패한 후보)을 가르는 일은 전적으로 당신 몫이다.

::: warn 에러 메시지는 요구사항이 아니다
158줄 중 어디에도 "`JointReading`에 `operator>`를 추가하라"는 지시는 없다. 컴파일러는 **당신이 뭘 원했는지 모른다** — `T`가 무엇이어야 하는지에 대한 제약이 코드 어디에도 쓰여 있지 않았기 때문이다. 에러 메시지는 실패 지점을 알려줄 뿐, 애초에 무엇을 만족해야 통과했을지는 알려주지 않는다. concepts가 바꾸는 지점이 정확히 여기다.
:::

## concepts 이전: SFINAE와 enable_if

::: hist C++20 이전엔 `std::enable_if`로 이 문제를 다뤘다
C++11~17 시절에도 "이 타입은 안 된다"를 표현하는 길은 있었다 — `template <typename T, typename = std::enable_if_t<std::is_floating_point_v<T>>>`처럼, 조건이 거짓이면 그 템플릿 자체가 오버로드 후보에서 조용히 빠지게 만드는 **SFINAE**(Substitution Failure Is Not An Error, "치환 실패는 에러가 아니다") 기법이다. 동작은 하지만 대가가 컸다 — 제약이 함수 시그니처의 세 번째 익명 타입 파라미터 안에 파묻혀 사람이 읽기 어렵고, 실패하면 방금 본 것과 같은 종류의 방대한 후보 목록이 그대로 쏟아졌다. C++20은 이 복잡함을 언어 차원에서 없앴다 — 제약을 표현하는 문법 자체를 표준에 넣은 것이 concepts다.
:::

## concept 정의와 requires 절

**콘셉트(concept)** 는 타입이 만족해야 할 조건에 이름을 붙인 것이다. `<concepts>` 헤더는 표준 콘셉트를 미리 정의해 둔다 — `std::floating_point<T>`(부동소수점), `std::integral<T>`(정수), `std::equality_comparable<T>`(`==` 지원), `std::convertible_to<From, To>`(암묵 변환 가능) 등이다. 이 이름들을 `requires` 절로 템플릿에 건다.

```cpp title="concept_basic.cpp"
#include <concepts>
#include <iostream>

template <typename T>
    requires std::floating_point<T>   // T는 반드시 부동소수점이어야 한다
T half_val(T v) {
    return v / 2;
}

int main() {
    std::cout << half_val(7.5) << "\n";
    std::cout << half_val(7.5f) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra concept_basic.cpp -o concept_basic
$ ./concept_basic
3.75
3.75
```

(g++ 13.3 실측.) `requires std::floating_point<T>`는 "이 함수 템플릿은 `T`가 부동소수점일 때만 후보에 오른다"는 선언이다. 이제 이 함수에 구조체를 넘기면 어떻게 되는지 실측으로 대비해 본다.

```cpp title="concept_violation.cpp"
#include <concepts>
#include <iostream>

template <typename T>
    requires std::floating_point<T>
T half_val(T v) {
    return v / 2;
}

struct JointReading {
    double angle;
    double torque;
};

int main() {
    JointReading a{1.2, 3.4};
    auto m = half_val(a);   // JointReading은 floating_point가 아니다
    (void)m;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c concept_violation.cpp -o /dev/null
concept_violation.cpp: In function 'int main()':
concept_violation.cpp:17:22: error: no matching function for call to 'half_val(JointReading&)'
   17 |     auto m = half_val(a);
      |              ~~~~~~~~^~~
concept_violation.cpp:6:3: note: candidate: 'template<class T>  requires  floating_point<T> T half_val(T)'
    6 | T half_val(T v) {
      |   ^~~~~~~~
concept_violation.cpp:6:3: note:   template argument deduction/substitution failed:
concept_violation.cpp:6:3: note: constraints not satisfied
In file included from concept_violation.cpp:1:
/usr/include/c++/13/concepts: In substitution of 'template<class T>  requires  floating_point<T> T half_val(T) [with T = JointReading]':
concept_violation.cpp:17:22:   required from here
/usr/include/c++/13/concepts:109:13:   required for the satisfaction of 'floating_point<T>' [with T = JointReading]
/usr/include/c++/13/concepts:109:30: note: the expression 'is_floating_point_v<_Tp> [with _Tp = JointReading]' evaluated to 'false'
  109 |     concept floating_point = is_floating_point_v<_Tp>;
      |                              ^~~~~~~~~~~~~~~~~~~~~~~~
```

(g++ 13.3 실측 — 16줄.) 앞의 `vector<JointReading>` 사례(158줄, 후보 16개)와 정확히 같은 성격의 실수(요구 조건을 만족 못 하는 타입을 넘김)인데, 여기서는 후보가 하나뿐이고 그 후보가 왜 탈락했는지도 한 줄로 나온다 — `constraints not satisfied`, 그리고 `the expression 'is_floating_point_v<_Tp>' ... evaluated to 'false'`. **어떤 조건을, 어떤 타입에 대해, 왜 만족하지 못했는지가 메시지 안에 그대로 있다.** ADL이 `std` 네임스페이스 전체를 후보로 끌어들이는 일 자체가 없다 — `requires` 절이 애초에 후보를 하나로 줄여 놓았기 때문이다. SFINAE 시절에도 최종적으로 이 문장에 준하는 실패는 났지만, 그 한 줄을 찾으려면 오버로드 후보 전체를 훑어야 했다. concepts는 애초에 후보를 좁혀서, 찾을 것 자체를 줄인다.

## 커스텀 concept 작성

표준 콘셉트로 충분하지 않을 때는 직접 정의한다. `requires { }` **표현식**(requires expression, 위의 `requires` **절**과는 다른 문법이다 — 아래에서 구분한다)으로 "이 타입이 특정 연산을 지원하는가"를 코드로 적는다. `max_val`에 정말 필요한 조건은 "부동소수점"이 아니라 "`>` 비교가 되는가"다.

```cpp title="custom_concept.cpp"
#include <iostream>

// requires 표현식: 괄호 안 가상의 변수로 표현식을 시도해 보고, 유효하면 통과한다
template <typename T>
concept Comparable = requires(T a, T b) {
    { a > b } -> std::convertible_to<bool>;   // a > b가 유효하고 bool로 변환 가능해야 한다
};

template <typename T>
    requires Comparable<T>
T max_val(T a, T b) {
    return a > b ? a : b;
}

struct JointReading {
    double angle;
    double torque;
    bool operator>(const JointReading& other) const { return angle > other.angle; }
};

int main() {
    std::cout << max_val(3, 5) << "\n";
    std::cout << max_val(3.5, 1.2) << "\n";
    JointReading a{1.2, 3.4};
    JointReading b{2.2, 1.4};
    std::cout << max_val(a, b).angle << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra custom_concept.cpp -o custom_concept
$ ./custom_concept
5
3.5
2.2
```

(g++ 13.3 실측.) `concept Comparable = requires(T a, T b) { ... };`가 정의 문법이다 — `requires` 뒤 괄호는 "이 타입의 가상 변수 `a`, `b`가 있다고 치자"는 뜻이고, 중괄호 안은 그 변수로 시험해 볼 표현식이다. `{ a > b } -> std::convertible_to<bool>`은 "`a > b`가 컴파일되고, 그 결과가 `bool`로 변환 가능해야 한다"는 두 조건을 한 줄에 담는다. `JointReading`은 이번엔 `operator>`를 직접 정의해 뒀으므로 통과한다.

이 콘셉트를 만족 못 하는 타입을 넘기면 무슨 일이 나는지 확인한다.

```cpp title="custom_concept_violation.cpp"
#include <iostream>

template <typename T>
concept Comparable = requires(T a, T b) {
    { a > b } -> std::convertible_to<bool>;
};

template <typename T>
    requires Comparable<T>
T max_val(T a, T b) {
    return a > b ? a : b;
}

struct RawLog {
    double values[3];   // operator> 없음
};

int main() {
    RawLog a{{1.0, 2.0, 3.0}};
    RawLog b{{4.0, 5.0, 6.0}};
    auto m = max_val(a, b);
    (void)m;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c custom_concept_violation.cpp -o /dev/null
custom_concept_violation.cpp: In function 'int main()':
custom_concept_violation.cpp:21:21: error: no matching function for call to 'max_val(RawLog&, RawLog&)'
   21 |     auto m = max_val(a, b);
      |              ~~~~~~~^~~~~~
custom_concept_violation.cpp:10:3: note: candidate: 'template<class T>  requires  Comparable<T> T max_val(T, T)'
   10 | T max_val(T a, T b) {
      |   ^~~~~~~
custom_concept_violation.cpp:10:3: note:   template argument deduction/substitution failed:
custom_concept_violation.cpp:10:3: note: constraints not satisfied
custom_concept_violation.cpp: In substitution of 'template<class T>  requires  Comparable<T> T max_val(T, T) [with T = RawLog]':
custom_concept_violation.cpp:21:21:   required from here
custom_concept_violation.cpp:4:9:   required for the satisfaction of 'Comparable<T>' [with T = RawLog]
custom_concept_violation.cpp:4:22:   in requirements with 'T a', 'T b' [with T = RawLog]
custom_concept_violation.cpp:5:9: note: the required expression '(a > b)' is invalid
    5 |     { a > b } -> std::convertible_to<bool>;
      |       ~~^~~
cc1plus: note: set '-fconcepts-diagnostics-depth=' to at least 2 for more detail
```

(g++ 13.3 실측 — 17줄, 후보는 정확히 1개.) 마지막 줄이 정확한 처방전이다 — `the required expression '(a > b)' is invalid`. `RawLog`에 `operator>`를 추가하면 통과한다는 사실이 메시지 자체에서 읽힌다. 158줄과 17줄 — 근본 원인은 둘 다 "이 타입엔 비교 연산이 없다"로 동일한데, `requires` 절이 있고 없고에 따라 컴파일러가 뒤지는 후보의 개수가 16개에서 1개로 줄어든다.

::: note requires 절과 requires 표현식은 다른 문법이다
헷갈리기 쉬운 지점이다. **requires 절**(`template <typename T> requires std::floating_point<T>`)은 템플릿에 제약을 "거는" 자리다 — 콘셉트 이름이나 불리언 표현식을 받는다. **requires 표현식**(`requires(T a, T b) { ... }`)은 콘셉트를 "정의하는" 재료다 — 임의의 표현식이 유효한지를 컴파일 타임에 시험해 참/거짓 하나로 접는다. 이 절의 `Comparable`은 requires 표현식으로 정의됐고, `max_val`은 그 `Comparable`을 requires 절로 걸었다 — 둘이 함께 쓰이는 것이 일반적인 패턴이다.
:::

## 콘셉트 간결 문법

`requires` 절을 매번 쓰지 않아도 되는 축약 문법이 있다. 템플릿 파라미터 목록에 `typename` 대신 콘셉트 이름을 직접 쓰거나, `auto` 파라미터 앞에 콘셉트를 붙인다.

```cpp title="abbrev.cpp"
#include <concepts>
#include <iostream>

// 축약 문법 -- template<typename T> requires std::floating_point<T> 와 완전히 같다
std::floating_point auto half_val(std::floating_point auto v) {
    return v / 2;
}

template <std::integral T>   // 템플릿 파라미터 목록에 콘셉트 이름을 직접 쓰는 형태
T twice(T v) {
    return v * 2;
}

int main() {
    std::cout << half_val(7.5) << "\n";
    std::cout << twice(21) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra abbrev.cpp -o abbrev
$ ./abbrev
3.75
42
```

(g++ 13.3 실측.) `template <std::integral T>`는 `template <typename T> requires std::integral<T>`를 한 줄로 줄인 것뿐, 의미는 완전히 같다 — 어느 쪽을 쓸지는 순전히 가독성 취향이다. `std::floating_point auto half_val(...)`처럼 반환 타입과 파라미터 타입 자리에 `콘셉트 auto`를 쓰는 문법은 좀 더 나아간다 — 이것은 [4.7 auto, decltype](#/type-deduction)에서 볼 축약 함수 템플릿(abbreviated function template) 문법과 콘셉트를 합친 것으로, `template <typename T> requires ...`라는 헤더 줄 자체를 생략하고 함수 시그니처 한 줄에 제약과 타입 추론을 함께 적는다.

## 콘셉트와 오버로딩

서로 다른 콘셉트로 제약한 같은 이름의 함수는 **오버로드**된다 — 컴파일러가 인자 타입을 보고 조건을 만족하는 쪽을 고른다.

```cpp title="overload_concepts.cpp"
#include <concepts>
#include <iostream>

template <std::integral T>
void report(T v) { std::cout << "정수 처리: " << v << "\n"; }

template <std::floating_point T>
void report(T v) { std::cout << "부동소수점 처리: " << v << "\n"; }

int main() {
    report(42);     // int -- integral 쪽
    report(3.14);   // double -- floating_point 쪽
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra overload_concepts.cpp -o overload_concepts
$ ./overload_concepts
정수 처리: 42
부동소수점 처리: 3.14
```

(g++ 13.3 실측.) `std::integral`과 `std::floating_point`는 겹치지 않으므로 인자 타입 하나당 정확히 한 후보만 남는다 — 오버로드 해석([1.6](#/functions))이 늘 이렇게 깔끔하게 갈리지는 않는다. 제약이 겹치는 경우, 즉 **한 후보가 다른 후보의 조건을 완전히 포함하는 경우**엔 어느 쪽이 이길까.

```cpp title="subsumption.cpp"
#include <concepts>
#include <iostream>

template <typename T>          // 제약 없음 -- 뭐든 받는다
void classify(T) { std::cout << "일반 타입\n"; }

template <std::integral T>     // 더 좁은(더 제약이 강한) 오버로드
void classify(T) { std::cout << "정수 타입\n"; }

int main() {
    classify(42);      // 두 오버로드 다 후보
    classify(3.14);    // integral 제약 불만족 -- 일반 쪽만 남는다
    classify("text");  // 마찬가지
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra subsumption.cpp -o subsumption
$ ./subsumption
정수 타입
일반 타입
일반 타입
```

(g++ 13.3 실측.) `classify(42)`는 두 오버로드 모두 후보에 오른다 — `T`가 제약 없는 쪽도 `int`를 받고, `std::integral<T>` 쪽도 받는다. 컴파일러는 이때 **제약의 부분 순서(partial ordering of constraints)** 를 본다 — "`std::integral<T>`를 만족하는 모든 타입은 자동으로 제약 없는 쪽도 만족하지만 역은 아니다"라는 포함 관계를 서브섬션(subsumption)이라 부르고, **더 좁게 제약된(subsuming) 쪽이 항상 이긴다.** 이것은 클래스 템플릿의 전체/부분 특수화([4.2](#/class-templates))에서 "더 구체적인 쪽이 우선한다"는 규칙과 정확히 같은 발상을 함수 오버로드에 적용한 것이다. 컴파일러가 타입 변환의 관대함(오버로드 해석)이나 코드의 특수성(템플릿 특수화)을 이미 서열화해 왔던 것처럼, 제약의 강도도 서열화한다.

## 로봇 도메인: 콜백과 수치 타입에 제약을 새긴다

[9.1 Eigen](#/eigen)에서 다룰 행렬·벡터 연산은 스칼라 타입(대개 `float`나 `double`)에 사칙연산과 `sqrt` 지원을 전제로 짜인다. 이런 수치 유틸리티를 직접 확장한다면 — 예를 들어 헥사포드 다리 여섯 개의 관절각을 한 번에 처리하는 함수를 `float`와 `double` 양쪽에서 쓰고 싶다면 — "이 스칼라 타입은 사칙연산자를 지원하는가"를 `Comparable`과 같은 방식의 커스텀 콘셉트로 못박아 둘 수 있다. SFINAE로 같은 조건을 걸었을 때보다, 조건을 위반한 호출의 에러 메시지가 훨씬 짧고 정확해진다는 이득은 이 절에서 실측한 것과 동일하다. rclcpp의 `create_subscription<MessageT>`처럼 "콜백이 특정 메시지 타입 하나를 인자로 받는 호출 가능한 대상이어야 한다"는 형태의 템플릿 API를 직접 설계할 때도 같은 도구가 쓰인다 — 콜백 시그니처 요구사항을 `std::invocable`이나 커스텀 콘셉트로 표현하면, 시그니처가 안 맞는 콜백을 넘겼을 때 [10.2 토픽](#/pub-sub)에서 볼 구독 등록 코드가 SFINAE 시절의 방대한 에러 대신 "이 콜백은 이 메시지 타입으로 호출할 수 없다"는 한 줄을 낸다.

::: interview concepts가 SFINAE보다 나은 점 / requires의 두 가지 쓰임
답변 뼈대: ① **표현력** — SFINAE는 `enable_if`로 제약을 익명 타입 파라미터 안에 숨겨야 했지만, concepts는 `requires std::floating_point<T>`처럼 제약을 함수 시그니처에서 바로 읽을 수 있게 언어 차원에서 지원한다. ② **에러 진단** — 실측으로 답한다: 같은 종류의 실수(비교 연산 없는 타입을 넘김)가 SFINAE 경로(ADL이 `std` 네임스페이스 전체를 후보로 끌어들임)에서는 158줄·후보 16개로 나오고, concepts 경로에서는 16~17줄·후보 1개로 나온다 — 제약이 처음부터 후보를 좁히기 때문이다. ③ **오버로드 해석과의 통합** — 서로 다른 콘셉트로 제약된 오버로드는 제약의 부분 순서(subsumption)로 서열화된다 — 더 좁게 제약된 쪽이 이긴다. ④ `requires`가 **두 가지로 쓰인다는 것을 구분해서 답한다** — requires 절(제약을 거는 자리, `template<typename T> requires C<T>`)과 requires 표현식(콘셉트를 정의하는 재료, `requires(T a){ ... }`)은 문법도 위치도 다르다.
:::

## 요약

- 제약 없는 템플릿에 커스텀 타입을 넘기면 실패가 인스턴스화 시점까지 미뤄지고, ADL이 관련 없는 네임스페이스(`std` 등)의 연산자 후보까지 끌어들여 에러가 통제 불능으로 길어진다(실측: `vector<JointReading>` 158줄, 후보 16개).
- C++20 이전엔 `std::enable_if` 기반 SFINAE로 같은 문제를 다뤘다 — 동작은 했지만 제약이 시그니처에 숨어 있고 실패 시 같은 종류의 방대한 후보 목록이 났다. C++20은 이 복잡함을 없앴다.
- **requires 절**(`template <typename T> requires std::floating_point<T>`)로 표준 콘셉트를 템플릿에 건다. 제약을 위반하면 `constraints not satisfied`와 함께 **어떤 조건이 왜 거짓인지**가 명시된 짧은 에러가 난다(실측: 16줄, 후보 1개).
- **커스텀 concept**은 `requires { }` **표현식**으로 정의한다 — `{ a > b } -> std::convertible_to<bool>;`처럼 "이 표현식이 유효하고 결과 타입이 이렇다"를 시험한다. requires 절(제약을 거는 자리)과 requires 표현식(콘셉트를 만드는 재료)은 서로 다른 문법이다.
- 축약 문법 — `template <std::integral T>`나 `std::floating_point auto` 파라미터로 `requires` 헤더 줄 자체를 생략할 수 있다. 의미는 완전히 동일하다.
- 서로 다른 콘셉트로 제약한 함수는 오버로드된다. 제약이 겹치면(한쪽이 다른 쪽을 포함하면) **제약의 부분 순서(subsumption)** 에 따라 더 좁게 제약된 쪽이 이긴다 — 템플릿 특수화의 "더 구체적인 쪽이 우선"과 같은 원리다.
- 커스텀 수치 타입이나 콜백 시그니처에 제약을 새기는 패턴은 Eigen 확장([9.1](#/eigen))이나 rclcpp 구독 API([10.2](#/pub-sub))처럼 "타입이 특정 연산을 지원해야 하는" 템플릿 API를 직접 설계할 때 그대로 쓰인다.

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. `vector<JointReading>` 사례(158줄)와 `concept_violation.cpp`(16줄)는 근본 원인이 똑같은데도 에러 길이가 크게 다르다. 그 차이가 나는 지점을 ADL과 "후보를 미리 좁힌다"는 개념으로 설명하라.

2. requires 절과 requires 표현식의 문법·역할 차이를 각각 예시와 함께 설명하라. 이 절의 `max_val`은 둘 중 어느 쪽을 어디에 썼는가?

3. `subsumption.cpp`의 세 번째 호출 `classify("text")`에서 어느 오버로드가 선택될지, 그리고 그 이유를 제약의 부분 순서 개념으로 예측하라. 실행해서 확인하라.

4. **[코드 작성]** `Sizeable`이라는 콘셉트를 직접 작성하라 — `requires(T t) { { t.size() } -> std::convertible_to<std::size_t>; }` 형태로, "이 타입이 `size()` 멤버 함수를 갖고 `size_t`로 변환 가능한 값을 반환하는가"를 확인한다. 이 콘셉트로 제약된 함수 템플릿 `describe`를 작성해 `std::vector<int>`와 `std::string`을 각각 넘겨 컴파일이 통과하는지 확인하라. 성공 기준: `g++ -std=c++20 -Wall -Wextra` 경고 없이 통과.

5. **[코드 작성]** 4번의 `describe`에 `size()`가 없는 커스텀 구조체(예: `struct Point { double x, y; };`)를 넘겨 컴파일하고, 에러 메시지에서 `constraints not satisfied`와 `the required expression`이 나온 줄을 각각 찾아라. 그다음 이 절의 `maxval_vector_err.cpp`를 그대로 타이핑해 실행하고, `grep -c "note: candidate"`로 후보 개수를 세어 두 에러의 줄 수·후보 수를 직접 비교하라.
:::

::: answer 해설
1. `vector<JointReading>`의 `max_val`은 제약이 없어 컴파일러가 `operator>`(또는 `operator<=>`)의 후보를 ADL로 찾아야 한다. 인자 타입이 `std::vector<JointReading>`이므로 ADL은 네임스페이스 `std` 전체를 뒤지고, 거기 있는 반복자 어댑터·pair·filesystem 관련 연산자 후보 16개를 하나하나 "이것도 아니다"로 보고한다. `concept_violation.cpp`는 `requires std::floating_point<T>`가 애초에 오버로드 후보를 하나로 줄여 놓아 ADL이 후보를 늘릴 여지가 없다 — 근본 원인은 같지만 컴파일러가 확인해야 할 후보 수 자체가 다르다.
2. requires 절은 이미 있는 콘셉트(또는 불리언 표현식)를 템플릿에 제약으로 "거는" 자리다 — `template <typename T> requires std::floating_point<T>`. requires 표현식은 콘셉트를 "정의하는" 재료다 — `requires(T a, T b) { { a > b } -> std::convertible_to<bool>; }`처럼 임의 표현식의 유효성을 참/거짓으로 접는다. `max_val`은 `requires Comparable<T>`로 requires 절을 썼고, `Comparable` 자체는 requires 표현식으로 정의됐다.
3. `"text"`의 타입은 `const char*` 계열이라 `std::integral`을 만족하지 못한다 — 제약 없는 오버로드만 후보로 남으므로 "일반 타입"이 출력된다. 부분 순서 비교 자체가 성립하려면 두 오버로드가 모두 후보여야 하는데, 여기선 애초에 `classify<std::integral T>` 쪽이 탈락해 경쟁이 벌어지지 않는다.
4. `std::vector<int>`는 `.size()`가 `size_t`를 반환하므로 통과하고, `std::string`도 마찬가지로 `.size()`를 갖고 있어 통과한다. 두 타입 다 `describe`를 호출해도 경고 없이 컴파일되면 콘셉트가 올바르게 작성된 것이다.
5. `Point`는 `.size()`가 없으므로 `describe(Point{1,2})`는 `constraints not satisfied`와 함께 `the required expression '(t.size())' is invalid`류의 문장을 낸다. `maxval_vector_err.cpp`의 후보 수는 `grep -c "note: candidate" 산출.txt`로 세면 16이 나와야 한다 — 근본 원인(비교 연산 없음)은 4번의 실패와 같지만 후보 수 차이가 에러 길이 차이로 그대로 이어진다는 것이 이 문제의 핵심이다.
:::

이 절의 다섯 코드는 전부 네 IDE에서 직접 타이핑하라. 특히 `maxval_struct_only.cpp`와 `maxval_vector_err.cpp`를 각각 컴파일해 에러 줄 수를 `g++ ... 2>&1 | wc -l`로 직접 세어 보고, `concept_violation.cpp`의 결과와 비교하라 — "158줄과 16줄"이 이 책의 서술이 아니라 네 터미널에 그대로 뜨는 숫자라는 것을 확인하는 것이 이 절의 핵심 실습이다. 기준 명령: `g++ -std=c++20 -Wall -Wextra custom_concept.cpp -o custom_concept && ./custom_concept`, 에러 재현은 `g++ -std=c++20 -Wall -Wextra -c 파일.cpp -o /dev/null`.

**다음 절**: [4.6 constexpr와 컴파일 타임 계산](#/constexpr) — 타입에 제약을 새기는 법을 봤으니, 이제 값 자체를 컴파일 타임에 계산해 런타임 비용을 아예 없애는 `constexpr`/`consteval`을 본다.
