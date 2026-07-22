# 4.1 함수 템플릿

::: lead
[1.6](#/functions)에서 오버로딩을 배웠다 — 같은 이름의 함수 여러 개를 컴파일러가 인자 타입으로 골라 쓰는 기능이다. 그런데 `int`용 `max_val`과 `double`용 `max_val`의 본문은 토씨 하나 안 다르다. 타입만 다른 함수를 손으로 몇 번이고 다시 쓰는 이 반복을, 컴파일러에게 "타입은 나중에 채워 넣을 테니 본문 한 벌만 봐 달라"고 맡기는 것이 함수 템플릿이다. 이 절은 그 문법과, 컴파일 시점에 실제로 무슨 일이 벌어지는지(인스턴스화)를 위젯과 `nm`으로 직접 확인한다.
:::

## 오버로드가 세 개, 네 개가 되는 순간

라이다 스캔의 최댓값을 고르든, 두 관절각 중 큰 쪽을 고르든, "둘 중 큰 것"을 고르는 로직은 타입이 바뀌어도 똑같다. `int`와 `double`, 그리고 로그에 남길 `std::string` 라벨까지 세 타입을 지원해야 한다면 [1.6](#/functions)에서 배운 오버로딩으로 이렇게 쓰게 된다.

```cpp title="overloads.cpp — 셋 다 본문이 완전히 같다"
#include <iostream>
#include <string>

int max_val(int a, int b) { return a > b ? a : b; }
double max_val(double a, double b) { return a > b ? a : b; }
std::string max_val(const std::string& a, const std::string& b) { return a > b ? a : b; }

int main() {
    std::cout << max_val(3, 5) << "\n";
    std::cout << max_val(3.5, 1.2) << "\n";
    std::cout << max_val(std::string("alpha"), std::string("beta")) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra overloads.cpp -o overloads
$ ./overloads
5
3.5
beta
```

(g++ 13.3 실측.) 세 함수의 본문은 `return a > b ? a : b;` 한 줄로 완전히 같다. 다른 것은 시그니처의 타입뿐이다. 헥사포드 관절 그룹을 표현하는 커스텀 타입 `JointReading`도 비교해야 한다면, 네 번째 오버로드를 또 통째로 베껴 써야 한다. `operator>`만 정의돼 있으면 비교 로직 자체는 타입과 무관하게 성립하는데도, C++의 오버로딩은 **함수를 타입 개수만큼 실제로 다시 작성하라고 요구한다.** [1.1](#/compile-model)에서 본 이름 맹글링과 만나면 이 반복이 더 또렷해진다 — `max_val(int, int)`와 `max_val(double, double)`은 `_Z7max_valii`와 `_Z7max_valdd`처럼 서로 다른 심볼로 컴파일되는, **링커 입장에서는 완전히 남남인 함수**다. 소스가 닮았다는 사실을 컴파일러는 전혀 모른다. 함수 템플릿은 이 문제를 정확히 겨냥한다 — **본문을 한 번만 쓰고, 타입을 채우는 일은 컴파일러에게 맡긴다.**

## 함수 템플릿 문법과 타입 추론

`overloads.cpp`의 세 함수를 템플릿 하나로 합친다. 문법은 함수 선언 위에 `template <typename T>`를 붙이고, 타입이 들어갈 자리에 실제 타입 이름 대신 `T`를 쓰는 것뿐이다.

```cpp title="tmpl_basic.cpp — 세 오버로드가 함수 하나가 됐다"
#include <iostream>
#include <string>

template <typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}

int main() {
    std::cout << max_val(3, 5) << "\n";                           // T = int, 추론
    std::cout << max_val(3.5, 1.2) << "\n";                        // T = double, 추론
    std::cout << max_val(std::string("alpha"), std::string("beta")) << "\n"; // T = std::string, 추론
    std::cout << max_val<double>(3, 5.0) << "\n";                  // T를 double로 강제 지정
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra tmpl_basic.cpp -o tmpl_basic
$ ./tmpl_basic
5
3.5
beta
5
```

(g++ 13.3 실측.) 앞의 세 호출에서 `<int>`, `<double>`, `<std::string>` 같은 표기는 어디에도 없다. `max_val(3, 5)`를 보는 순간 컴파일러는 인자 두 개가 `int`라는 사실만으로 `T`가 `int`여야 함을 스스로 알아낸다. 이것이 **템플릿 인자 추론(template argument deduction)** 이다 — 호출부의 인자 타입을 템플릿 파라미터 목록과 맞춰 `T`를 역산하는, 컴파일 타임에만 벌어지는 작업이다. 마치 `auto`가 오른쪽 값에서 타입을 읽어내듯, 템플릿은 인자에서 타입을 읽어낸다.

마지막 호출 `max_val<double>(3, 5.0)`은 추론에 맡기지 않고 `T`를 **명시적으로 지정**한 경우다. `<double>`을 함수 이름 뒤에 붙이면 컴파일러는 추론을 건너뛰고 그 타입을 그대로 쓴다. 인자로 준 `3`은 `int` 리터럴이지만 `T`가 이미 `double`로 못박혔으므로, 함수 파라미터 자리에서 `int`가 `double`로 암묵 변환된다([1.4](#/casting)). 실측 출력이 `5`로 끝난 것도 그래서다 — `3`을 `3.0`으로 바꿔 `double` 버전을 호출하고, 결과 `5.0`을 `std::cout`이 `5`로 찍는다. 명시적 지정을 쓰는 자리는 두 곳이다 — 추론이 아예 실패하는 경우(뒤에서 본다), 추론은 되지만 호출자가 의도적으로 다른 타입을 강제하고 싶은 경우.

## 템플릿 인스턴스화의 실체

`tmpl_basic.cpp`는 함수를 하나만 썼는데 실행 결과는 마치 세 함수가 있는 것처럼 나왔다. 컴파일된 오브젝트 파일 안을 들여다보면 실제로 무슨 일이 일어났는지 보인다. [1.1](#/compile-model)에서 오버로딩된 함수들이 서로 다른 맹글링된 심볼로 컴파일되는 것을 `nm`으로 확인했던 것과 같은 도구를 쓴다.

```console
$ g++ -std=c++20 -Wall -Wextra -c tmpl_basic.cpp -o tmpl_basic.o
$ nm -C tmpl_basic.o | grep max_val
0000000000000000 W std::__cxx11::basic_string<char, ...> max_val<std::__cxx11::basic_string<char, ...> >(std::__cxx11::basic_string<...>, std::__cxx11::basic_string<...>)
0000000000000000 W double max_val<double>(double, double)
0000000000000000 W int max_val<int>(int, int)
```

(g++ 13.3 / `nm -C`로 이름 복원, 실측 — `std::string`의 완전한 템플릿 인자 목록은 지면상 `...`로 줄였다.) 함수 템플릿을 **딱 하나** 썼는데, 오브젝트 파일 안에는 서로 다른 주소를 가진 **완전히 별개인 함수가 세 개** 들어 있다. `max_val<int>`, `max_val<double>`, `max_val<std::string>` — 이름도, 기계어 코드도 각자 따로 존재한다. `max_val<double>(3, 5.0)` 호출은 목록에서 새 심볼을 만들지 않았다 — `T`가 이미 `double`인 호출과 같은 타입이기 때문이다. 심볼은 **호출된 `T`의 종류마다** 하나씩 생기지, 호출 횟수만큼 생기지 않는다.

이 과정을 **템플릿 인스턴스화(template instantiation)** 라 부른다. 함수 템플릿 자체는 실행 코드가 아니라 컴파일러에게 주는 설계도이고, 어떤 타입으로 호출되는 순간 그 타입을 `T` 자리에 치환해 컴파일러가 "찍어낸다." 심볼에 붙은 `W`(weak) 표시도 단서다 — 인스턴스화된 템플릿 함수는 여러 번역 단위에서 중복 정의돼도 괜찮은 약한 심볼이다. 헤더를 여러 `.cpp`가 include했을 때 링커가 중복 인스턴스를 접는 방식은 [1.10](#/linkage)에서 본 `inline`의 ODR 예외와 같다 — 컴파일러가 템플릿 인스턴스에 자동으로 `inline` 취급을 준다고 보면 된다.

이 과정을 스텝 단위로 재생하며 확인한다.

::: widget template-instantiation
:::

스텝을 하나씩 넘기며 `max_val(3, 7)`, `max_val(3.5, 2.1)`, `max_val(std::string("a"), std::string("b"))` 세 호출이 들어올 때마다 컴파일러가 새 함수를 찍어내는 과정을 보라. 되감기로 거꾸로 돌려 "몇 번째 호출까지 몇 개의 함수가 존재했는가"를 스스로 짚어 봐라 — 우측 인스턴스 카드가 하나씩 늘어나는 것이 방금 `nm`으로 확인한 세 심볼과 정확히 같은 그림이다.

## 왜 템플릿은 헤더에 있어야 하는가

[1.9](#/headers)에서 선언과 정의를 나눠 헤더/소스로 분리하는 구조를 배웠다. 일반 함수는 그렇게 나눠도 아무 문제가 없다. 템플릿도 같은 방식으로 나눠 본다 — 선언은 헤더에, 정의는 `.cpp`에.

```cpp title="max_val.h — 선언만"
#pragma once

template <typename T>
T max_val(T a, T b);
```

```cpp title="max_val.cpp — 정의는 여기"
#include "max_val.h"

template <typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}
```

```cpp title="main_split.cpp — 헤더만 include해서 쓴다"
#include <iostream>
#include "max_val.h"

int main() {
    std::cout << max_val(3, 5) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c main_split.cpp -o main_split.o
$ g++ -std=c++20 -Wall -Wextra -c max_val.cpp -o max_val.o
$ g++ main_split.o max_val.o -o main_split
/usr/bin/ld: main_split.o: in function `main':
main_split.cpp:(.text+0x13): undefined reference to `int max_val<int>(int, int)'
collect2: error: ld returned 1 exit status
```

(g++ 13.3 실측.) 두 `.cpp`는 각각 경고 없이 컴파일된다 — 문제는 링크 단계에서 터진다. [1.1](#/compile-model)에서 본 것과 똑같은 모양의 `undefined reference`지만 원인은 다르다. 일반 함수라면 `max_val.cpp`를 컴파일할 때 이미 `max_val(int, int)`의 기계어가 `max_val.o`에 들어 있을 것이다. 그런데 **컴파일러는 `max_val.cpp`를 컴파일하는 시점에 `T`가 무엇이 될지 전혀 모른다.** 이 파일 안에는 `max_val`을 호출하는 코드가 없으니 인스턴스화할 타입도 없다. `main_split.cpp` 쪽은 `T = int`가 필요하다는 것은 알지만, 그 순간 보이는 것은 `max_val.h`의 선언(본문 없음)뿐이라 인스턴스화할 재료가 없다. **양쪽 다 "타입 정보"와 "본문"을 동시에 가진 적이 없어서, 실제로 찍어낼 수 있는 쪽이 어디에도 없다.**

해법은 정의를 헤더로 옮기는 것뿐이다.

```cpp title="max_val_fixed.h — 정의까지 헤더에"
#pragma once

template <typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra main_fixed.cpp -o main_fixed
$ ./main_fixed
5
```

(g++ 13.3 실측 — 경고 없이 링크까지 끝난다.) `main_fixed.cpp`가 `max_val_fixed.h`를 include하는 순간, 그 번역 단위 안에 `max_val`의 **본문**과 `max_val(3, 5)`라는 **호출**이 동시에 존재한다. 컴파일러는 그 자리에서 `T = int`를 추론하고 바로 인스턴스화해 `max_val<int>(int, int)`를 `main_fixed.o`에 직접 찍어 넣는다. **템플릿을 인스턴스화하려면 컴파일러가 호출 시점에 본문 전체를 봐야 한다** — 이것이 템플릿을 헤더에 통째로 넣는 이유의 전부다.

::: hist `export` 키워드 — 시도됐다가 사실상 폐기됐다
C++98은 `export template` 키워드로 템플릿 정의를 헤더 밖에 두는 길을 표준에 남겨 뒀다. 이를 제대로 구현한 컴파일러는 사실상 하나(Comeau/EDG)뿐이었고 GCC와 MSVC는 끝까지 구현하지 않았다. 아무도 안 쓰는 기능을 남겨 둘 이유가 없어 C++11에서 `export`는 완전히 제거됐다. **템플릿은 헤더에 넣는다**는 규칙은 임시방편이 아니라, 대안이 시도됐다가 위원회 스스로 폐기를 확정한 결론이다.
:::

## 타입 추론이 실패하는 지점

타입 추론은 인자에서 `T` **하나**를 뽑아내는 절차다. 그런데 같은 템플릿 파라미터 `T`를 쓰는 두 인자에 서로 다른 타입을 넘기면 어떻게 될까.

```cpp title="deduce_fail.cpp"
#include <iostream>

template <typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}

int main() {
    std::cout << max_val(3, 3.5) << "\n";   // 첫 인자는 int, 둘째는 double
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c deduce_fail.cpp
deduce_fail.cpp: In function 'int main()':
deduce_fail.cpp:9:25: error: no matching function for call to 'max_val(int, double)'
    9 |     std::cout << max_val(3, 3.5) << "\n";
      |                  ~~~~~~~^~~~~~~~
deduce_fail.cpp:4:3: note: candidate: 'template<class T> T max_val(T, T)'
    4 | T max_val(T a, T b) {
      |   ^~~~~~~
deduce_fail.cpp:4:3: note:   template argument deduction/substitution failed:
deduce_fail.cpp:9:25: note:   deduced conflicting types for parameter 'T' ('int' and 'double')
```

(g++ 13.3 실측.) 마지막 줄이 원인을 말해 준다 — `deduced conflicting types for parameter 'T' ('int' and 'double')`. 첫 인자 `3`을 보면 `T = int`가 맞고, 둘째 인자 `3.5`를 보면 `T = double`이 맞다. 시그니처 `T max_val(T a, T b)`는 두 파라미터가 **같은** `T`를 쓰겠다고 못박았는데 서로 다른 두 후보가 나왔으니 추론이 성립하지 않는다. **오버로드 해석([1.6](#/functions))이 승격·변환으로 관대하게 후보를 골랐던 것과 달리, 템플릿 추론은 정확 일치만 본다** — `int`를 슬쩍 `double`로 승격해서 맞춰 주는 일은 없다.

해법은 이미 봤다 — `T`를 명시적으로 지정하면 추론을 건너뛴다.

```cpp title="deduce_fixed.cpp"
std::cout << max_val<double>(3, 3.5) << "\n";   // T를 명시하면 int가 double로 변환된다
```

```console
$ g++ -std=c++20 -Wall -Wextra deduce_fixed.cpp -o deduce_fixed
$ ./deduce_fixed
3.5
```

(g++ 13.3 실측.) `<double>`로 `T`를 못박으면 두 파라미터는 이미 둘 다 `double`로 확정된 상태에서 인자를 받는다 — 이제는 추론이 아니라 평범한 암묵 변환 문제라 `3`이 `3.0`으로 조용히 바뀐다. 명시적 지정보다 먼저 물을 질문도 있다 — "애초에 `int`와 `double`을 둘 다 받아야 하는 함수가 맞는가?" 그렇다면 `template <typename T, typename U>`로 파라미터마다 별도 타입을 주는 설계가 낫다. 그 경우 반환 타입을 `T`와 `U` 중 뭘로 할지가 새 문제가 되고, 이는 [4.5 concepts](#/concepts)와 `decltype`([4.7](#/type-deduction))이 다룬다.

## 템플릿 매개변수의 세 가지 얼굴

지금까지 쓴 `typename T`는 "타입 하나를 매개변수로 받는다"는 가장 흔한 형태지만 전부는 아니다.

**`typename`과 `class`는 완전히 같은 의미다.** 템플릿 파라미터 선언에서는 둘을 바꿔 써도 차이가 없다.

```cpp title="class_vs_typename.cpp"
template <class T>          // typename 대신 class -- 완전히 같은 의미다
T max_val(T a, T b) {
    return a > b ? a : b;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra class_vs_typename.cpp -o class_vs_typename
$ ./class_vs_typename
5
```

(g++ 13.3 실측 — `tmpl_basic.cpp`와 본문이 완전히 같고 `typename` 대신 `class`만 썼는데도 경고 없이 같은 결과를 낸다.) `T`에 클래스 타입이 아니라 `int` 같은 내장 타입을 넣어도 에러가 안 난다는 사실이 그 증거다. 역사적으로 `typename`이 나중에 추가된 동의어이고, 지금은 스타일 문제다 — 이 책은 "타입 하나"라는 의미가 더 분명한 `typename`을 쓴다.

**non-type 템플릿 매개변수**는 타입이 아니라 정수 같은 **값**을 컴파일 타임 인자로 받는다. `template<int N>`이 대표적인 형태이고, 로봇 코드에서는 다리 하나의 관절 개수처럼 "타입마다 다른 게 아니라 용도마다 다른 고정 크기"를 표현할 때 쓰인다.

```cpp title="nontype_param.cpp"
template <int N>   // 타입이 아니라 정수 값 하나를 템플릿 인자로 받는다
struct JointGroup {
    std::array<double, N> angles{};   // N이 컴파일 타임 상수라 배열 크기로 바로 쓰인다
    constexpr int joint_count() const { return N; }
};

int main() {
    JointGroup<3> leg;                 // 다리 하나 -- coxa/femur/tibia
    JointGroup<6> hexapod_front_row;   // 6관절 그룹
    std::cout << leg.joint_count() << " " << hexapod_front_row.joint_count() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra nontype_param.cpp -o nontype_param
$ ./nontype_param
3 6
```

(g++ 13.3 실측.) `JointGroup<3>`과 `JointGroup<6>`은 서로 다른 `N`으로 인스턴스화된 완전히 별개의 타입이다 — `std::array<double, 3>`과 `std::array<double, 6>`이 다른 타입인 것과 같은 이유다. 클래스 템플릿의 전체 문법과 특수화는 [4.2](#/class-templates)에서 다룬다.

**`auto` 템플릿 매개변수(C++20)** 는 non-type 매개변수의 타입 자체도 추론에 맡긴다. `template<int N>`은 반드시 `int`만 받지만 `template<auto N>`은 정수든 부동소수점이든 그 자리에 온 값의 타입을 그대로 받는다.

```cpp title="auto_param.cpp"
template <auto N>   // C++20 -- 값의 타입 자체도 추론에 맡긴다
struct FixedCount {
    static constexpr auto value = N;
};

int main() {
    std::cout << FixedCount<3>::value << "\n";     // N은 int로 추론
    std::cout << FixedCount<3.0>::value << "\n";   // N은 double로 추론
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra auto_param.cpp -o auto_param
$ ./auto_param
3
3
```

(g++ 13.3 실측.) `FixedCount<3>`은 `N`을 `int`로, `FixedCount<3.0>`은 `N`을 `double`로 추론한다 — 두 줄 다 `3`으로 나온 건 `std::cout`이 `double 3.0`을 소수점 없이 찍기 때문이지 값이 달라서가 아니다. 지금은 "값의 타입까지 컴파일러가 추론하는 문법이 있다" 정도만 챙기면 된다.

## 코드 팽창: 찍어낼수록 커진다

앞의 위젯 마지막 스텝이 예고한 그대로다 — 같은 템플릿을 호출하는 타입이 늘어날수록 실행 파일 안의 함수도 그만큼 늘어난다. 인스턴스 하나가 하나, 둘이 아니라 **여러 개**로 늘어나면 무엇이 커지는지 직접 잰다.

```cpp title="bloat_one.cpp — max_val을 int 하나로만 쓴다"
template <typename T>
T max_val(T a, T b) { return a > b ? a : b; }

int main() {
    std::cout << max_val(3, 5) << "\n";
    return 0;
}
```

```cpp title="bloat_many.cpp — 같은 템플릿을 여섯 타입으로 쓴다"
template <typename T>
T max_val(T a, T b) { return a > b ? a : b; }

int main() {
    std::cout << max_val(3, 5) << "\n";
    std::cout << max_val(3.5, 1.2) << "\n";
    std::cout << max_val(3.5f, 1.2f) << "\n";
    std::cout << max_val(3L, 5L) << "\n";
    std::cout << max_val('a', 'b') << "\n";
    std::cout << max_val(std::string("alpha"), std::string("beta")) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 bloat_one.cpp -o bloat_one
$ g++ -std=c++20 -Wall -Wextra -O0 bloat_many.cpp -o bloat_many
$ nm bloat_one | grep -c max_val
1
$ nm bloat_many | grep -c max_val
6
$ size bloat_one
   text    data     bss     dec     hex filename
   1829     624     280    2733     aad bloat_one
$ size bloat_many
   text    data     bss     dec     hex filename
  15559     784     280   16623    40ef bloat_many
```

(g++ 13.3 / `-O0` / Linux x86-64 실측 — 절대값은 버전마다 다르지만 "타입 수만큼 함수가 늘어난다"는 방향은 어디서나 같다.) `max_val` 심볼 개수가 호출에 쓰인 타입 수(1개 vs 6개)와 정확히 일치한다. `.text` 크기는 1829바이트에서 15559바이트로 8배 넘게 늘었다 — 대부분은 `std::string` 버전이 `operator>`·소멸자·복사 등 문자열 관련 코드를 끌고 들어온 몫이지만, 나머지 `float`/`long`/`char` 버전도 각자 자기 몫의 기계어를 보탠다. **템플릿은 소스 코드의 중복을 없애 주지만, 컴파일된 바이너리의 중복까지 없애 주지는 않는다** — 호출 타입이 늘 때마다 사실상 같은 로직의 기계어가 그만큼 복제된다. 이 현상이 **코드 팽창(code bloat)** 이다. 왜 이런 구조가 됐는지, 컴파일러가 이 팽창을 실제로 얼마나 접어 주는지는 [4.3 템플릿 인스턴스화의 실체](#/template-mechanics)에서 더 다룬다.

::: perf 코드 팽창은 실행 속도와는 별개 문제다
코드 팽창이 늘리는 것은 바이너리 **크기**이지 개별 호출의 **속도**가 아니다. 오히려 각 인스턴스는 그 타입 전용으로 컴파일되므로 런타임 타입 분기가 전혀 없다 — [3.4 vtable](#/virtual-vtable)의 가상 함수 호출이 함수 포인터를 한 번 더 따라가는 것과 대조된다. 문제가 되는 지점은 실행 속도가 아니라 명령어 캐시([8.2](#/cache))다 — 바이너리가 커지면 자주 실행되는 코드가 캐시 라인에 덜 들어맞을 수 있다. 임베디드 타깃처럼 플래시 용량이 빠듯한 로봇 하드웨어에서는 이 트레이드오프를 실제로 계산해야 한다.
:::

## 로봇 도메인: Eigen도 거대한 템플릿 라이브러리다

[9.1 Eigen](#/eigen)에서 다룰 `Eigen::Matrix3d`, `Eigen::Vector3d` 같은 타입은 전부 클래스 템플릿의 인스턴스다 — `Matrix3d`는 실제로 `Matrix<double, 3, 3>`의 별칭(alias)이고, 행과 열의 크기가 non-type 템플릿 매개변수로 박혀 있다. 3×3 행렬 곱셈과 4×4 행렬 곱셈은 서로 다른 인스턴스로 각각 컴파일되고, 컴파일러는 크기가 컴파일 타임에 고정돼 있다는 사실을 이용해 루프를 완전히 펼쳐(loop unrolling) 최적화한다 — 크기를 런타임 인자로 받는 함수라면 불가능하다. 헥사포드 순기구학([9.4](#/forward-kinematics))의 3×3 회전 행렬 곱셈이 함수 호출 오버헤드 없이 인라인된 기계어로 도는 이유가 이것이다 — **크기별로 특수화된 코드를 컴파일 타임에 찍어낸다**는 이 절의 원리가 Eigen에서는 성능으로 직결된다.

::: interview 템플릿과 오버로딩의 차이 / 템플릿을 헤더에 둬야 하는 이유
답변 뼈대: ① **코드를 누가 쓰는가가 다르다** — 오버로딩은 각 타입 버전을 개발자가 손으로 전부 작성하고, 템플릿은 본문을 한 번만 쓰고 컴파일러가 호출 타입마다 별도 함수를 인스턴스화한다. ② **관용도 차이**를 실측으로 짚는다 — 오버로드 해석은 승격·변환까지 고려하지만([1.6](#/functions)), 템플릿 추론은 정확 일치만 보므로 `max_val(3, 3.5)`처럼 파라미터 간 타입이 안 맞으면 바로 에러다. ③ **헤더에 둬야 하는 이유는 인스턴스화의 전제 조건**이다 — 템플릿을 실제 함수로 찍어내려면 컴파일러가 호출 시점에 타입 정보와 본문을 동시에 봐야 하는데, 정의가 다른 `.cpp`에 있으면 인스턴스화가 불가능하다. `export` 키워드로 이 제약을 없애려던 C++98의 시도가 구현되지 않아 C++11에서 제거됐다는 사실까지 답하면 "찾아본 티"가 난다. ④ **대가로 코드 팽창이 따라온다** — 호출 타입이 늘수록 실행 파일에 컴파일된 함수 개수도 늘어난다(실측: 타입 6개 → 심볼 6개, `.text` 8배 증가).
:::

## 요약

- 오버로딩은 타입마다 함수 본문을 손으로 복제해야 한다([1.6](#/functions)). 함수 템플릿(`template <typename T>`)은 본문을 한 번만 쓰고 호출 타입마다 컴파일러가 별도 함수를 찍어내게 한다.
- 호출부는 보통 `T`를 명시하지 않는다 — 인자 타입에서 컴파일러가 스스로 추론한다(**템플릿 인자 추론**). `max_val<double>(3, 5.0)`처럼 `<타입>`을 붙이면 추론을 건너뛰고 `T`를 강제할 수 있다.
- **템플릿 인스턴스화**는 실재한다 — `nm -C`로 확인하면 함수 템플릿 하나가 호출된 타입 수만큼(`int`/`double`/`std::string`) 서로 다른 주소·다른 심볼을 가진 실제 함수로 컴파일돼 있다.
- 템플릿은 **호출 시점에 본문 전체가 보여야만** 인스턴스화할 수 있다. 정의를 `.cpp`에 두고 헤더에는 선언만 두면 `undefined reference`로 링크가 깨진다(실측). 이것이 템플릿을 헤더에 통째로 넣는 이유다 — 대안이던 `export` 키워드는 C++11에서 제거됐다.
- 템플릿 추론은 오버로드 해석과 달리 승격·변환을 허용하지 않는다 — 같은 `T`를 쓰는 두 파라미터에 `int`와 `double`을 섞어 넘기면 `deduced conflicting types` 에러가 난다(실측). 해법은 명시적 `T` 지정이나 별도 타입 파라미터 설계.
- 템플릿 매개변수는 세 종류다 — 타입(`typename`/`class`, 완전히 동의어), non-type(`template<int N>`, 컴파일 타임 값), `auto`(C++20, 값의 타입까지 추론).
- 호출 타입이 늘수록 컴파일된 함수 개수와 바이너리 크기가 함께 는다 — **코드 팽창**(실측: 6개 타입 → 심볼 6개, `.text` 1829→15559바이트). 속도가 아니라 크기·명령어 캐시 문제다. [4.3](#/template-mechanics)에서 더 깊이 다룬다.
- Eigen의 `Matrix3d`는 크기를 non-type 템플릿 매개변수로 받는 클래스 템플릿의 인스턴스다 — 크기별 특수화 코드가 로봇 제어 루프의 행렬 연산 성능을 좌우한다([9.1](#/eigen)).

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. 오버로딩과 함수 템플릿이 "타입마다 다른 함수가 필요하다"는 점은 같은데도 유지보수 관점에서 근본적으로 다른 이유를 설명하라. 오버로드 해석과 템플릿 인자 추론 중 어느 쪽이 암묵적 타입 변환에 더 관대한가?

2. `deduce_fail.cpp`의 에러 메시지 마지막 줄 `deduced conflicting types for parameter 'T' ('int' and 'double')`가 무엇을 말하는지, `T`가 파라미터 두 개에 각각 어떻게 추론됐는지로 설명하라.

3. 함수 템플릿의 정의를 헤더가 아니라 `.cpp`에만 두고, 그 템플릿을 호출하는 코드를 같은 `.cpp` 안에 둔다면 링크가 성공할지 실패할지 예측하고 이유를 대라.

4. (실습) `overloads.cpp`를 타이핑해 실행한 뒤, 넷째 타입 `long`용 오버로드를 손으로 추가해 봐라. 그다음 같은 기능을 함수 템플릿 하나로 다시 짜서 `long`, `int`, `double`, `std::string` 네 타입 모두를 오버로드 추가 없이 호출해 봐라. 성공 기준: 경고 없이 컴파일되고, `nm -C`로 인스턴스가 정확히 4개 확인된다.

5. (실습) `deduce_fail.cpp`를 타이핑해 에러를 재현하고 `note` 세 줄을 다 읽어라. 그다음 ① `max_val<double>(...)`로 명시적 지정 ② 둘째 인자를 `static_cast<int>(3.5)`로 캐스팅 — 두 방법으로 각각 컴파일을 통과시키고, 두 해법이 내는 값이 서로 다르다는 것을 출력으로 확인하라.
:::

::: answer 해설
1. 오버로딩은 타입이 하나 늘 때마다 본문을 다시 작성해야 하고, 그 본문들은 컴파일러 입장에서 서로 무관한 별개 함수다 — 버그를 고치려면 오버로드 개수만큼 고쳐야 한다. 템플릿은 본문이 물리적으로 하나뿐이라 고칠 곳도 하나다. 암묵 변환은 오버로드 해석이 더 관대하다 — 정확 일치/승격/변환 세 단계를 다 보지만, 템플릿 추론은 정확 일치만 보고 승격조차 안 해 준다.
2. 첫 인자 `3`은 `int`라 `T = int`가, 둘째 인자 `3.5`는 `double`이라 `T = double`이 각각 추론된다. 시그니처 `T max_val(T a, T b)`는 두 파라미터가 **같은** `T`를 요구하므로, 서로 다른 두 후보가 나온 시점에 추론이 실패로 처리된다.
3. 성공한다. 템플릿이 헤더에 있어야 하는 이유는 "호출 시점에 본문과 타입 정보가 같은 번역 단위에 함께 있어야 한다"는 것이지 확장자 규칙이 아니다. 정의와 호출이 같은 `.cpp` 안에 있으면 그 번역 단위에서 인스턴스화가 끝난다. 다른 `.cpp`에서도 쓰려면 그때 헤더로 옮겨야 `undefined reference`를 피한다.
4. `long` 오버로드는 `long max_val(long a, long b) { return a > b ? a : b; }`처럼 같은 본문을 또 베끼는 형태다. 템플릿 버전은 `overloads.cpp`의 함수 네 개를 지우고 `template <typename T> T max_val(T a, T b) {...}` 하나로 교체하면 끝난다 — `nm -C 산출물.o | grep -c max_val`이 4면 성공이다.
5. `note`는 순서대로 후보 시그니처, 추론 실패 지점, 충돌한 두 타입을 알려 준다. `max_val<double>(3, 3.5)`는 `3`을 `3.0`으로 바꿔 `3.5`를 낸다. `max_val(static_cast<int>(3.5), 3)`은 `max_val(3, 3)`이 되어 `3`을 낸다 — 타입을 무엇으로 통일했는가에 따라 소수부 정보를 보존하느냐 버리느냐가 갈린다.
:::

이 절의 코드는 전부 네 IDE에서 직접 쳐라. 특히 `tmpl_basic.cpp`를 컴파일한 뒤 `nm -C 산출물.o | grep max_val`을 돌려 심볼이 몇 개 나오는지 눈으로 세어 봐라 — 위젯에서 본 "찍혀 나오는" 과정이 비유가 아니라는 것이 이 한 줄로 확인된다. `max_val.h`/`max_val.cpp`/`main_split.cpp` 세 파일은 그대로 분리 컴파일해 링크 에러를 먼저 재현한 다음 정의를 헤더로 옮겨 고쳐라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, 분리 컴파일은 `g++ -c a.cpp -o a.o && g++ -c b.cpp -o b.o && g++ a.o b.o -o main`.

**다음 절**: [4.2 클래스 템플릿과 특수화](#/class-templates) — 함수 하나를 찍어내는 법을 봤으니, 이제 타입 전체를(`Matrix3d`처럼) 찍어내는 클래스 템플릿과, 특정 타입에서만 다르게 동작하게 만드는 특수화를 본다.
