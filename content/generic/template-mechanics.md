# 4.3 템플릿 인스턴스화의 실체

::: lead
[4.1](#/function-templates)에서 템플릿 하나가 호출되는 타입마다 별도의 코드를 "찍어낸다"는 것, 그리고 그게 바이너리 크기를 불린다는 것을 봤다. 그런데 정확히 **언제** 찍히는가? 컴파일러가 템플릿 정의를 보는 순간인가, 아니면 다른 시점인가? 그리고 `a.cpp`와 `b.cpp`가 둘 다 같은 템플릿을 같은 타입으로 쓰면 둘 다 각자 코드를 찍어낼 텐데, 그러면 [1.10](#/linkage)에서 배운 ODR(하나의 정의 규칙)에 걸려 링크가 깨져야 하는 것 아닌가? 이 절은 이 두 질문에 `nm`과 실제 컴파일러 출력으로 답한다. 답을 알고 나면 헤더에 템플릿 정의를 통째로 넣는 관행이, 왜 안 써도 되는 명시적 인스턴스화라는 예외 장치가 표준에 남아 있는지, 그리고 그 대가로 컴파일 시간이 얼마나 늘어나는지까지 한 줄로 꿰어진다.
:::

## 인스턴스화는 정의를 보는 순간이 아니라 쓰이는 순간에 일어난다

다음 헤더를 준비한다.

```cpp title="templates.hpp"
#pragma once

template <typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}
```

이 헤더만 include하고 `max_val`을 한 번도 부르지 않는 번역 단위를 컴파일해서 오브젝트 파일의 심볼 테이블을 열어 본다.

```cpp title="c.cpp"
#include "templates.hpp"

int unrelated() {
    return 42;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c c.cpp
$ nm -C c.o
0000000000000000 T unrelated()
```

`templates.hpp`를 include했는데도 `c.o`의 심볼 테이블에는 `max_val`이 **아예 존재하지 않는다.** 정의가 눈에 들어왔다는 사실만으로는 아무 코드도 만들어지지 않는다는 뜻이다. 이제 같은 헤더를 쓰되 실제로 호출하는 두 개의 번역 단위를 만든다.

```cpp title="a.cpp"
#include "templates.hpp"

int use_in_a(int x, int y) {
    return max_val(x, y);
}
```

```cpp title="b.cpp"
#include "templates.hpp"

int use_in_b(int x, int y) {
    return max_val(x, y);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c a.cpp b.cpp
$ nm -C a.o
0000000000000000 W int max_val<int>(int, int)
0000000000000000 T use_in_a(int, int)
$ nm -C b.o
0000000000000000 W int max_val<int>(int, int)
0000000000000000 T use_in_b(int, int)
```

이번에는 `a.o`와 `b.o` **둘 다**에 `max_val<int>(int, int)`의 정의가 들어가 있다. 각 번역 단위가 자기 안에서 `max_val`을 호출하는 순간, 그 호출 지점에서 컴파일러가 `T = int`로 코드를 새로 찍어낸 것이다. 여기서 두 가지 사실이 동시에 확정된다.

1. **인스턴스화는 호출부(사용 시점)에서, 그 호출을 담은 번역 단위 안에서 일어난다.** `c.cpp`처럼 정의만 보이고 호출이 없으면 인스턴스화 자체가 없다. `a.cpp`와 `b.cpp`처럼 각자 호출하면 각자 인스턴스화한다 — 서로의 존재를 모른 채로.
2. 그런데 심볼 종류가 [1.1](#/compile-model)에서 본 `T`(정의 있음)도 `U`(정의 없음)도 아니다. **`W`다.** 처음 보는 글자다. 이게 왜 붙었는지, 그리고 이 두 오브젝트 파일을 링크하면 무슨 일이 나는지는 다음 절에서 바로 푼다. 지금은 "같은 함수의 정의가 서로 다른 두 오브젝트 파일에 중복으로 들어 있다"는 사실만 기억해 둔다 — [1.10](#/linkage)의 ODR을 그대로 적용하면 이건 `multiple definition` 에러가 나야 할 상황이다.

## 암묵적 인스턴스화의 시점: 왜 안 쓴 멤버 함수의 에러는 안 걸리는가

방금 확인한 "쓰이는 순간에만 인스턴스화된다"는 규칙에는 함정이 하나 딸려 있다. 컴파일러가 템플릿 정의를 처음 읽을 때 하는 일과, 실제로 인스턴스화할 때 하는 일이 다르다는 것이다. 이를 **2단계 이름 조회(two-phase lookup)**라 부른다.

- **1단계(정의 시점)**: 템플릿 파라미터에 의존하지 않는 이름과 문법은 **템플릿 정의를 읽는 즉시** 검사한다. 세미콜론이 빠졌거나 존재하지 않는 전역 함수를 부르면 인스턴스화 여부와 무관하게 그 자리에서 에러가 난다.
- **2단계(인스턴스화 시점)**: 템플릿 파라미터 `T`에 의존하는 이름(`T`의 멤버, `T`에 대한 연산자 등)은 **실제로 어떤 타입으로 인스턴스화될 때까지 검사를 미룬다.**

말로는 추상적이니 실측한다. 아래 함수는 `T x`에 대해 존재하지 않는 멤버 함수를 부른다. 문법은 완벽하다 — `T`가 무엇인지 모르는 컴파일러 입장에서는 `x.this_method_does_not_exist()`가 유효한 멤버 호출 표현식**일 수도** 있다.

```cpp title="uncalled_dependent.cpp"
#include <iostream>

template <typename T>
void broken(T x) {
    x.this_method_does_not_exist();
}

int main() {
    std::cout << "인스턴스화 없이 컴파일만 통과\n";
    return 0;
}
```

`broken`은 한 번도 호출되지 않는다. 컴파일해 본다.

```console
$ g++ -std=c++20 -Wall -Wextra -c uncalled_dependent.cpp
$ echo $?
0
```

**경고 하나 없이 통과한다.** `broken` 함수는 정의는 되어 있지만 어떤 `T`로도 인스턴스화되지 않았고, `x.this_method_does_not_exist()`는 `T`에 의존하는 표현식이라 2단계 검사 대상이다. 2단계가 실행된 적이 없으니 이 표현식이 말이 되는지 확인할 기회 자체가 없었다. 이제 딱 한 줄, 호출을 추가한다.

```cpp title="called_dependent.cpp"
#include <iostream>

template <typename T>
void broken(T x) {
    x.this_method_does_not_exist();
}

int main() {
    broken(42);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c called_dependent.cpp
called_dependent.cpp: In instantiation of 'void broken(T) [with T = int]':
called_dependent.cpp:9:11:   required from here
called_dependent.cpp:5:7: error: request for member 'this_method_does_not_exist' in 'x', which is of non-class type 'int'
```

`broken(42)`가 `T = int`로 인스턴스화를 촉발하자마자 2단계 검사가 실행되고, 그제서야 `int`에 그런 멤버가 없다는 사실이 드러난다. 에러 메시지의 `In instantiation of ... required from here`가 정확히 "무엇을 인스턴스화하다가 걸렸는가"를 말해 준다.

::: warn 이게 왜 함정인가
클래스 템플릿의 멤버 함수는 각각 **독립된 템플릿처럼** 취급된다 — 클래스가 인스턴스화되어도 실제로 호출된 멤버 함수만 그 시점에 개별적으로 인스턴스화된다. 즉 `Wrapper<int>` 객체를 만들어 `get()`만 쓰고 `broken_method()`는 한 번도 안 부르면, `broken_method()` 안에 아무리 심각한 타입 오류가 있어도 컴파일은 조용히 통과한다.

```cpp title="class_template_unused_member.cpp"
template <typename T>
class Wrapper {
public:
    explicit Wrapper(T v) : value_(v) {}
    T get() const { return value_; }

    void broken_method() const {
        value_.nonexistent();   // int에는 없는 멤버 — 그런데 안 부르면 안 걸린다
    }

private:
    T value_;
};
```

실측(`-Wall -Wextra`, `Wrapper<int> w(42); w.get();`만 호출): 컴파일·실행 모두 통과, 출력은 `42`. 안 쓰는 멤버 함수 안에 있는 버그는 **그 멤버 함수를 쓰는 코드를 작성하기 전까지 발견되지 않는다.** 헤더 온리 클래스 템플릿을 작성할 때 "컴파일이 되니 맞겠지"라고 넘어가면 안 되는 이유다 — 모든 멤버 함수를 최소 한 번씩은 실제로 호출해 보는 테스트가 인스턴스화를 강제하는 유일한 방법이다.
:::

## 여러 번역 단위, 같은 인스턴스: 왜 링크 에러가 안 나는가

첫 절에서 미뤄 둔 질문으로 돌아간다. `a.o`와 `b.o` 둘 다 `max_val<int>(int, int)`의 완전한 정의를 갖고 있다. 링크해 본다.

```console
$ g++ -std=c++20 a.o b.o main.o -o prog
$ ./prog
7 9
```

**에러 없이 링크되고 정상 실행된다.** 대조군을 만들어 본다 — 이번엔 템플릿이 아니라 그냥 평범한 함수를 헤더에 정의(`inline` 없이)해서 똑같은 상황을 재현한다.

```cpp title="plain.hpp"
#pragma once

int max_val_plain(int a, int b) {
    return a > b ? a : b;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c a.cpp b.cpp   # 둘 다 plain.hpp include, max_val_plain 호출
$ g++ -std=c++20 a.o b.o -o prog
/usr/bin/ld: b.o: in function `max_val_plain(int, int)':
b.cpp:(.text+0x0): multiple definition of `max_val_plain(int, int)'; a.o:a.cpp:(.text+0x0): first defined here
```

똑같이 "헤더에 정의를 두고 두 TU에서 각자 include해 인스턴스화(컴파일)"했는데, 평범한 함수는 `multiple definition`으로 죽고 템플릿 함수는 멀쩡히 링크된다. 차이는 앞서 미뤄 둔 그 글자, `W`에 있다.

`nm`의 `T`/`U`는 [1.1](#/compile-model)에서 봤다. `W`는 **약한 심볼(weak symbol)**이다 — [1.10](#/linkage)에서 `inline` 함수가 여러 TU에 정의돼도 ODR 위반이 안 되는 이유로 이미 만난 그 메커니즘이다. 링커는 같은 이름의 약한 심볼을 여러 개 만나면 에러를 내지 않고 **그중 하나만 골라 쓰고 나머지는 버린다.** C++ 표준은 템플릿의 암묵적 인스턴스화 결과를 정확히 이 규칙 아래 둔다 — "같은 템플릿을 같은 인자로 인스턴스화한 정의는 여러 번역 단위에 나타나도 되며, 링커가 하나로 병합한다." 그렇지 않으면 헤더에 템플릿 정의를 쓰는 관행 자체가 성립할 수 없다 — 템플릿을 쓰는 모든 `.cpp`가 필연적으로 같은 인스턴스를 중복 생성하기 때문이다.

::: deep 컴파일러가 W를 만드는 방식
GCC는 암묵적으로 인스턴스화된 템플릿 함수를 자기 이름이 붙은 COMDAT 섹션(`.text._Z7max_valIiET_S0_S0_`)에 놓는다 — "같은 이름의 섹션이 여럿이면 링커가 하나만 남긴다"는 규칙이 적용되는 자리다. `readelf -sW a.o`로 보면 심볼 바인딩이 `WEAK`로 명시돼 있다. 부수 효과 하나: 두 TU가 서로 다른 최적화 레벨로 이 함수를 인스턴스화했다면 링커는 둘 중 **먼저 만난 것**을 채택한다 — 그래서 실무에서는 TU마다 최적화 플래그를 다르게 섞지 않는다.
:::

이름이 같아도 타입이 다르면 이 병합이 적용되지 않는다는 것도 짚어 둔다. `max_val<int>`와 `max_val<double>`은 [1.1](#/compile-model)에서 본 이름 맹글링 규칙에 따라 `_Z7max_valIiET_S0_S0_`와 `_Z7max_valIdET_S0_S0_`로 **애초에 다른 심볼**이라 병합 대상 자체가 아니다. 병합은 어디까지나 "같은 템플릿을 같은 타입 인자로 인스턴스화한 결과가 우연히 여러 TU에 나타났을 때"에만 일어난다.

## 명시적 인스턴스화: 정의를 헤더 밖으로 빼내기

지금까지 본 것은 전부 **암묵적 인스턴스화(implicit instantiation)** — 컴파일러가 호출을 보고 알아서 코드를 찍어내는 방식이다. 그런데 라이브러리를 만드는 입장이라면 정반대를 원할 때가 있다. 사용자에게 템플릿 **정의**(구현 전체)를 헤더로 노출하고 싶지 않거나, 지원하는 타입을 몇 개로 못박아 컴파일 시간을 줄이고 싶은 경우다. 이럴 때 쓰는 것이 **명시적 인스턴스화(explicit instantiation)**다: `template 반환타입 함수이름<타입>(인자타입...);` 문법으로 "이 타입으로는 지금 여기서 코드를 찍어 둬라"고 컴파일러에게 직접 지시한다.

먼저 명시적 인스턴스화 없이, 선언만 헤더에 두고 정의는 `.cpp`에 숨겨 본다.

```cpp title="lib.hpp"
#pragma once

// 선언만 노출한다 — 정의는 lib.cpp 안에 있다.
template <typename T>
T square(T x);
```

```cpp title="lib_no_explicit.cpp"
#include "lib.hpp"

template <typename T>
T square(T x) {
    return x * x;
}
```

```cpp title="user.cpp"
#include "lib.hpp"
#include <iostream>

int main() {
    std::cout << square(5) << "\n";
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c lib_no_explicit.cpp user.cpp
$ nm -C user.o | grep square
                 U int square<int>(int)
$ nm -C lib_no_explicit.o | grep square
(아무 것도 안 나온다)
$ g++ -std=c++20 user.o lib_no_explicit.o -o prog
/usr/bin/ld: user.o: in function `main':
user.cpp:(.text+0xe): undefined reference to `int square<int>(int)'
```

`user.o`는 선언만 보고 컴파일했으니 `U int square<int>(int)`를 남긴다. 그런데 `lib_no_explicit.o`에는 그 이름이 **아예 없다** — `lib_no_explicit.cpp`는 `square`의 정의를 갖고 있지만 자기 안에서 그것을 호출한 적이 없으므로, 첫 절에서 확인한 규칙 그대로 인스턴스화 자체가 일어나지 않았다. 링크는 실패한다. **정의를 어딘가에 "적어 두는 것"과 "인스턴스화해서 실제 코드로 만드는 것"은 다른 일이다.** 이제 `lib.cpp`에 명시적 인스턴스화 한 줄을 추가한다.

```cpp title="lib_explicit.cpp"
#include "lib.hpp"

template <typename T>
T square(T x) {
    return x * x;
}

template int square<int>(int);   // 명시적 인스턴스화 정의
```

```console
$ g++ -std=c++20 -Wall -Wextra -c lib_explicit.cpp
$ nm -C lib_explicit.o | grep square
0000000000000000 W int square<int>(int)
$ g++ -std=c++20 user.o lib_explicit.o -o prog
$ ./prog
25
```

`template int square<int>(int);`가 `T = int`에 대해 강제로 코드를 찍어내라는 지시였고, 그 결과 `lib_explicit.o`에 `W int square<int>(int)`가 실제로 들어간다. `user.o`의 `U`가 이걸 찾아 링크에 성공한다. 이 구조가 정확히 라이브러리 저자의 관점이다 — **사용자는 `lib.hpp`(선언만)만 받고, `square`의 실제 구현은 저자가 미리 컴파일해 둔 `lib.o`(또는 `.a`/`.so`)에 박혀 있다.** 소스를 감출 수 있고, 사용자 쪽 컴파일 시간에서 이 함수의 인스턴스화 비용이 통째로 빠진다.

단, 지원 범위는 명시적으로 인스턴스화해 둔 타입으로 못박힌다. `double`을 넘겨 보면 바로 드러난다.

```console
$ g++ -std=c++20 user2.o lib_explicit.o -o prog2   # user2.cpp가 square(2.5)도 호출
/usr/bin/ld: user2.o: in function `main':
user2.cpp:(.text+0x4d): undefined reference to `double square<double>(double)'
```

`lib_explicit.o`에는 `int` 버전만 있고 `double` 버전은 저자가 명시적으로 인스턴스화해 두지 않았다. 암묵적 인스턴스화라면 `user2.cpp`가 알아서 찍어냈겠지만, 이 구조에서는 정의 자체가 사용자에게 안 보이므로 그럴 수가 없다. **명시적 인스턴스화는 지원 타입을 저자가 고정하겠다는 선언이기도 하다.**

## extern template: 다시 찍어내지 말라는 지시 (C++11)

명시적 인스턴스화를 헤더 온리 코드에 적용하면 또 다른 문제가 남는다. 여러 TU가 같은 헤더를 include하면서 각자 암묵적 인스턴스화를 반복하는 것 — 링크 시에는 약한 심볼 덕에 하나로 병합되지만, **컴파일 시점의 반복 작업 자체는 TU마다 그대로 일어난다.** `extern template` 선언(C++11)은 이 낭비를 없애는 지시문이다: "이 인스턴스는 다른 어딘가에서 명시적으로 만들어질 것이니, 여기서는 다시 만들지 마라"고 컴파일러에게 알려 준다.

```cpp title="common.hpp"
#pragma once

template <typename T>
T max_val(T a, T b) { return a > b ? a : b; }

extern template int max_val<int>(int, int);   // "여기서는 만들지 마라"
```

```cpp title="owner.cpp"
#include "common.hpp"

template int max_val<int>(int, int);   // 실제로 여기서만 만든다
```

`common.hpp`를 include하는 다른 모든 TU는 `max_val<int>`를 다시 인스턴스화하지 않고, 링크 시 `owner.o`가 제공하는 `W` 심볼을 가져다 쓴다. 효과는 인스턴스화 대상이 무거울수록 뚜렷해진다. `-ftime-report`로 GCC 내부 시간을 재 보면(Eigen 행렬 연산을 감싼 템플릿 함수 기준, 3회 반복 측정), `extern template` 없이 컴파일한 TU는 `template instantiation` 단계에서 매번 204MB의 가비지 컬렉터 메모리를 쓰고, `extern template`을 적용한 TU는 매번 185MB를 쓴다 — 약 9% 감소이고, 3회 모두 정확히 같은 수치로 재현된다(이 지표는 벽시계 시간과 달리 실행마다 흔들리지 않는다). 함수 하나가 가벼우면 절약분도 작지만, 이런 인스턴스가 수십 개의 TU에 걸쳐 반복되는 대형 프로젝트에서는 누적된다.

## 컴파일 시간의 실체: 헤더 온리 라이브러리가 치르는 대가

지금까지의 실험은 전부 헤더에 정의를 두는 것의 **대가**를 가리키고 있다. 대가를 숫자로 확인한다. 아무것도 안 하는 파일과, 헤더 온리 선형대수 라이브러리 Eigen을 include만 하는 파일을 각각 컴파일해 걸리는 시간을 잰다.

```cpp title="empty_main.cpp"
int main() { return 0; }
```

```cpp title="eigen_main.cpp"
#include <Eigen/Dense>

int main() {
    Eigen::Matrix4d m = Eigen::Matrix4d::Identity();
    Eigen::Vector4d v(1.0, 2.0, 3.0, 1.0);
    Eigen::Vector4d r = m * v;
    return static_cast<int>(r.sum());
}
```

```console
$ g++ -std=c++20 -I/usr/include/eigen3 -c empty_main.cpp -o /dev/null
(3회 측정: 0.019s / 0.021s / 0.019s)

$ g++ -std=c++20 -I/usr/include/eigen3 -c eigen_main.cpp -o /dev/null
(3회 측정: 1.87s / 2.90s / 1.68s)
```

1줄짜리 `main`은 20밀리초 안팎으로 끝나는데, Eigen 헤더 하나를 include한 8줄짜리 파일은 **100배에서 150배** 느리다. 전처리 결과 줄 수로 보면 원인이 즉시 보인다.

```console
$ g++ -I/usr/include/eigen3 -E empty_main.cpp | wc -l
7
$ g++ -I/usr/include/eigen3 -E eigen_main.cpp | wc -l
154421
```

7줄이 154,421줄이 됐다 — [1.1](#/compile-model)에서 `<iostream>` 하나로 36,588줄이 됐던 것과 같은 현상이지만, 자릿수가 하나 더 크다. `-ftime-report`로 이 시간이 어디서 소모되는지 뜯어 보면, `phase parsing`(선언·템플릿 파싱을 포함)이 전체의 89%, 그 안에서 `template instantiation` 단계만 따로 떼도 17~26%를 차지한다. Eigen은 `Matrix`, `Vector` 같은 이름이 전부 템플릿이고, 헤더에 구현이 통째로 들어 있다 — **include하는 모든 `.cpp`가 이 파싱과 인스턴스화 비용을 처음부터 다시 치른다.** `<iostream>`처럼 컴파일러가 미리 컴파일해 캐시해 두는(precompiled header 등) 장치 없이 이 헤더를 쓰는 TU가 프로젝트 안에 100개 있으면, 이 비용도 그대로 100번 반복된다. [7.1 CMake 기초](#/cmake-basics)에서 다루는 빌드 시간 최적화(유닛 빌드, 사전 컴파일 헤더, 병렬 빌드)의 상당 부분은 결국 이 반복을 줄이거나 병렬로 흡수하는 이야기다.

## 로보틱스 도메인: Eigen과 ROS 2 패키지 빌드 시간

방금 잰 숫자가 추상적인 벤치마크가 아닌 이유가 있다. Eigen은 ROS 2에서 회전·변환·상태 추정([9.1](#/eigen), [9.2](#/rotations), [9.6](#/state-estimation))을 다루는 사실상 표준 라이브러리이고, `tf2`([10.7](#/tf2))부터 로봇 상태 추정 노드까지 폭넓게 include된다. 헥사포드 워크스페이스처럼 Eigen을 쓰는 패키지가 여러 개고 각 패키지 안에 Eigen을 include하는 `.cpp`가 여러 개면, 방금 확인한 "1개 TU당 +1.5~2.9초" 비용이 TU 개수만큼 곱해진다 — `colcon build`가 병렬로 돌려도([1.1](#/compile-model)에서 본 병렬 실행 구조), 코어 수를 넘어서는 순간부터는 이 누적 비용이 그대로 벽시계 시간에 반영된다. 큰 패키지에서 유독 빌드가 오래 걸리는 소스 파일이 있다면, 먼저 의심할 것은 알고리즘이 아니라 **그 파일이 include하는 헤더 온리 템플릿 라이브러리의 개수**다.

::: interview "템플릿은 왜 컴파일 시간을 늘리나 / 헤더에 정의해야 하는 진짜 이유"
자주 나오는 질문이고, "템플릿은 원래 그렇다"는 답으로는 부족하다. 뼈대는 이렇다. ① 템플릿이 컴파일 시간을 늘리는 직접 원인은 **같은 인스턴스가 여러 번역 단위에서 반복 생성**되기 때문이다 — 링크 시에는 약한 심볼로 하나로 합쳐지지만, 인스턴스화라는 **작업 자체**는 각 TU에서 독립적으로 다시 수행된다. 헤더 온리 라이브러리(Eigen 등)를 include하는 TU가 늘어날수록 이 중복 작업이 그대로 곱해진다. ② 헤더에 정의를 둬야 하는 이유는 [1.1](#/compile-model)에서 배운 "컴파일러는 번역 단위 바깥을 못 본다"는 제약과 정확히 맞물린다 — 템플릿은 호출부에서 실제 타입을 알아야 코드를 찍어낼 수 있는데(2단계 이름 조회), 정의가 다른 `.cpp`에 있으면 호출하는 TU는 그 정의를 볼 방법이 없다. 그래서 정의 자체를 include를 통해 호출부와 같은 TU 안으로 끌어와야 한다. ③ 이 제약을 피하는 유일한 예외가 명시적 인스턴스화다 — 지원할 타입을 저자가 미리 정해 라이브러리 쪽에서 코드를 만들어 두면, 사용자 TU는 정의를 몰라도 링크 단계에서 그 결과물만 가져다 쓸 수 있다. `nm`으로 `W`/`U` 심볼을 직접 짚어 가며 설명하면 "표면적인 문법이 아니라 빌드 파이프라인 단위로 이해하고 있다"는 신호가 된다.
:::

## 요약

- 인스턴스화는 템플릿 **정의를 보는 시점이 아니라 실제로 호출되는 번역 단위 안에서** 일어난다. 정의만 있고 호출이 없으면 해당 오브젝트 파일에 그 심볼은 아예 생기지 않는다(실측).
- 2단계 이름 조회 때문에, `T`에 의존하는 코드의 오류는 **인스턴스화가 실제로 일어나기 전까지 잡히지 않는다.** 안 쓰는 함수 템플릿, 안 쓰는 클래스 템플릿 멤버 함수 안의 버그는 그 함수를 실제로 호출하기 전까지 조용하다.
- 서로 다른 TU가 같은 템플릿을 같은 타입으로 암묵적 인스턴스화하면 결과물은 `T`가 아니라 **약한 심볼(`W`)**이다. 링커는 여러 `W`를 만나면 병합하고 넘어간다 — `inline` 함수가 ODR을 피하는 것과 같은 메커니즘([1.10](#/linkage)).
- `template 타입 함수<T>(인자);` 문법의 **명시적 인스턴스화**는 특정 타입에 대해서만 강제로 코드를 만들어 두는 것이다. 정의를 `.cpp`에 숨기고 헤더에는 선언만 노출하는 라이브러리 배포가 이걸로 가능해진다 — 단, 명시적으로 인스턴스화해 두지 않은 타입은 링크 에러가 난다.
- `extern template`(C++11)은 "이 인스턴스는 다른 곳에서 만든다, 여기서는 다시 만들지 마라"는 지시다. 컴파일 시간을 줄이는 목적이고, 실측으로도 GCC 내부 메모리 사용량이 재현 가능하게 줄어든다.
- 헤더 온리 템플릿 라이브러리를 include하는 비용은 실측으로 100배 단위다. Eigen처럼 ROS 2 전반에 쓰이는 라이브러리는 이 비용이 패키지 안의 TU 수만큼 곱해진다.

::: quiz 연습문제
1~3번은 개념·판별, 4~5번은 **직접 코드를 만들고 컴파일해서 확인하는** 실습이다.

1. `c.cpp`처럼 템플릿 정의를 include만 하고 호출은 하지 않는 파일을 컴파일하면 오브젝트 파일에 그 템플릿의 심볼이 생기는가? 왜 그런가?

2. `a.cpp`와 `b.cpp`가 각각 `max_val<int>`를 호출해 인스턴스화한 뒤 링크하면 에러가 안 난다. `nm`으로 확인할 수 있는 근거를 심볼 종류(글자) 기준으로 대라. 만약 `max_val`이 일반 함수(비템플릿)이고 `inline`도 안 붙어 있었다면 어떻게 됐을까?

3. `template int square<int>(int);`를 라이브러리의 `.cpp`에 추가했다. 사용자가 `square(3.5)`(double)를 호출하는 코드를 링크하면 무슨 에러가 나는가? 왜 컴파일이 아니라 링크 단계에서 나는가?

4. (실습, 코드 작성형) 아래 뼈대로 시작해 문법은 맞지만 존재하지 않는 멤버를 호출하는 함수 템플릿을 만들어라. 먼저 그 템플릿을 **호출하지 않고** 컴파일해 통과하는 것을 확인하고(`g++ -std=c++20 -Wall -Wextra -c 파일.cpp`), 그다음 호출을 한 줄 추가해 정확히 어느 줄에서 에러가 나는지 확인하라. 성공 기준: 같은 소스가 "호출 유무"만으로 컴파일 성패가 갈리는 것을 네 눈으로 본다.

   ```cpp title="quiz4_stub.cpp"
   template <typename T>
   void broken(T x) {
       // 여기에 x에 대해 존재하지 않을 멤버 호출을 넣어라
   }

   int main() {
       // 처음엔 broken을 호출하지 않는다
   }
   ```

5. (실습, 코드 작성형) 헤더에는 템플릿 **선언만** 두고 정의를 `.cpp`에 넣어 `undefined reference`를 직접 재현하라. 그다음 그 `.cpp`에 `template 반환타입 함수이름<타입>(인자타입);` 한 줄을 추가해 링크가 성공하는 것을 확인하라. 성공 기준: 같은 코드가 딱 한 줄 차이로 `undefined reference` → 정상 실행으로 바뀌는 것을 확인한다. 명령: `g++ -std=c++20 -Wall -Wextra -c lib.cpp user.cpp && g++ lib.o user.o -o prog && ./prog`
:::

::: answer 해설
1. 생기지 않는다. 인스턴스화는 호출부에서 일어나는데 `c.cpp`에는 호출이 없다. 정의를 include하는 것과 그 정의로 실제 코드를 찍어내는 것은 별개의 일이다.
2. `nm -C a.o`와 `nm -C b.o` 모두 `max_val<int>(int, int)`를 `W`(약한 심볼)로 보여 준다. 링커는 이름이 같은 약한 심볼 여러 개를 만나면 에러 없이 하나로 병합한다. 만약 `inline`도 없는 일반 함수였다면 두 오브젝트 파일 모두 `T`(강한 심볼)를 가지므로 링크 시 `multiple definition` 에러가 난다 — 실측으로 `plain.hpp` 버전이 정확히 이 에러를 낸다.
3. `undefined reference to 'double square<double>(double)'`가 링크 단계에서 난다. `.cpp`에는 `int`에 대한 명시적 인스턴스화만 있어서 오브젝트 파일에는 `int` 버전의 정의만 존재한다. 사용자 쪽은 선언만 보고 컴파일이 통과하지만(그래서 컴파일 에러가 아니다), 링크 시 `double` 버전의 정의를 어디서도 찾지 못한다.
4. 예시: `x.this_method_does_not_exist();`를 넣고 `int main() {}`만 두면 `g++ -std=c++20 -Wall -Wextra -c quiz4.cpp`가 경고 없이 통과한다(실측). `main` 안에 `broken(42);`를 추가하면 `In instantiation of 'void broken(T) [with T = int]'` 뒤에 `request for member ... in 'x', which is of non-class type 'int'`가 뜬다. 2단계 이름 조회가 인스턴스화 시점에야 `T`에 의존하는 표현식을 검사한다는 것의 직접 증거다.
5. `lib.hpp`에 `template <typename T> T func(T x);`(선언만), `lib.cpp`에 정의만 넣고 `template`으로 시작하는 인스턴스화 줄을 아직 안 넣으면 링크가 `undefined reference to 'func<...>(...)'`로 실패한다(실측). `template int func<int>(int);` 한 줄을 `lib.cpp` 끝에 추가하면 같은 명령이 그대로 성공하고 프로그램이 정상 실행된다 — 소스에서 바뀐 것은 그 한 줄뿐이다.
:::

지금 IDE 터미널에서 `templates.hpp` / `a.cpp` / `b.cpp`를 그대로 타이핑하고 `g++ -std=c++20 -Wall -Wextra -c a.cpp b.cpp && nm -C a.o b.o`로 `W` 심볼을 네 눈으로 확인하라. 그다음 연습문제 5번의 명시적 인스턴스화 재현을 끝까지 손으로 돌려라. 기준 명령: `g++ -std=c++20 -Wall -Wextra -c lib.cpp user.cpp && g++ lib.o user.o -o prog && ./prog`.

**다음 절**: [4.4 가변 인자 템플릿과 폴드 표현식](#/variadic-templates) — 인자 개수가 정해지지 않은 템플릿을 컴파일러가 어떻게 재귀 없이 펼쳐내는지 본다.
