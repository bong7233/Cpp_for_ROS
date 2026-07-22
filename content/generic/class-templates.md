# 4.2 클래스 템플릿과 특수화

::: lead
[4.1](#/function-templates)은 함수 하나를 여러 타입에 찍어내는 법을 다뤘다. 이 절은 같은 일을 클래스 전체에 적용한다 — 사실 이미 겪은 문법이다. [2.9](#/unique-ptr)에서 `std::unique_ptr<int>`와 `std::unique_ptr<Point>`를 아무렇지 않게 썼을 때, 그 둘은 서로 다른 두 개의 자료형이 아니라 `unique_ptr`라는 하나의 클래스 템플릿에서 컴파일러가 각각 찍어낸 결과물이었다. 이 절은 그 틀을 손으로 직접 짜 본다 — 로봇 관절 각도와 관절 토크라는, 거의 똑같이 생긴 두 클래스를 하나의 클래스 템플릿으로 합치면서, 템플릿 매개변수를 여럿 두는 법, 특정 타입에서만 다르게 동작하게 만드는 전체/부분 특수화, `using` 별칭, 그리고 C++17의 클래스 템플릿 인자 추론(CTAD)까지 실측으로 확인한다.
:::

## 문제: 관절 각도와 관절 토크, 거의 같은 클래스 두 벌

헥사포드 다리는 관절 각도(라디안, 대략 -1.57~1.57 범위)와 관절 토크(뉴턴미터, 대략 -5.0~5.0 범위)를 둘 다 다룬다. 둘 다 "범위를 벗어나면 안 되는 값"이라는 같은 규칙을 갖는다. 이 규칙을 손으로 두 번 짜면 이렇게 된다.

```cpp title="dup_classes.cpp — 거의 같은 클래스를 두 번 쓴다"
#include <cstdio>
#include <stdexcept>

class JointAngle {
public:
    JointAngle(double value, double min, double max)
        : value_(value), min_(min), max_(max) {
        check();
    }
    double get() const { return value_; }
    void set(double v) { value_ = v; check(); }
private:
    void check() const {
        if (value_ < min_ || value_ > max_) {
            throw std::out_of_range("JointAngle out of range");
        }
    }
    double value_;
    double min_;
    double max_;
};

class JointTorque {
public:
    JointTorque(double value, double min, double max)
        : value_(value), min_(min), max_(max) {
        check();
    }
    double get() const { return value_; }
    void set(double v) { value_ = v; check(); }
private:
    void check() const {
        if (value_ < min_ || value_ > max_) {
            throw std::out_of_range("JointTorque out of range");
        }
    }
    double value_;
    double min_;
    double max_;
};

int main() {
    JointAngle angle(1.2, -1.57, 1.57);
    JointTorque torque(3.0, -5.0, 5.0);
    std::printf("angle = %.2f, torque = %.2f\n", angle.get(), torque.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g dup_classes.cpp -o dup_classes
$ ./dup_classes
angle = 1.20, torque = 3.00
```

(g++ 13.3 실측.) 두 클래스는 이름과 예외 메시지 한 줄만 다르고 나머지는 토큰 단위로 동일하다. 여기에 관절 속도, 관절 전류가 더 붙으면 같은 코드를 네 번, 다섯 번 복사하게 된다. 복사가 늘어날수록 사고도 늘어난다 — `check()`의 부등호 방향을 한 곳에서만 고치고 나머지에 반영하지 못하는 것이 전형적인 실수다. [4.1](#/function-templates)이 함수에 대해 답했던 질문을 이번엔 클래스에 던진다. "타입만 다르고 로직이 완전히 같다면, 그 타입을 매개변수로 만들 수는 없는가."

## 클래스 템플릿 문법: 하나의 틀에서 두 클래스를 찍어낸다

답은 `template<typename T>`를 클래스 선언 앞에 붙이는 것이다. `JointAngle`과 `JointTorque`를 `BoundedValue<T>` 하나로 합친다.

```cpp title="bounded_value.hpp — 클래스 템플릿의 선언과 정의"
#ifndef BOUNDED_VALUE_HPP
#define BOUNDED_VALUE_HPP

#include <stdexcept>

template<typename T>
class BoundedValue {
public:
    BoundedValue(T value, T min, T max);
    T get() const;
    void set(T v);
private:
    void check() const;
    T value_;
    T min_;
    T max_;
};

template<typename T>
BoundedValue<T>::BoundedValue(T value, T min, T max)
    : value_(value), min_(min), max_(max) {
    check();
}

template<typename T>
T BoundedValue<T>::get() const {
    return value_;
}

template<typename T>
void BoundedValue<T>::set(T v) {
    value_ = v;
    check();
}

template<typename T>
void BoundedValue<T>::check() const {
    if (value_ < min_ || value_ > max_) {
        throw std::out_of_range("BoundedValue out of range");
    }
}

#endif
```

```cpp title="bv_basic.cpp"
#include <cstdio>
#include "bounded_value.hpp"

int main() {
    BoundedValue<double> angle(1.2, -1.57, 1.57);
    BoundedValue<double> torque(3.0, -5.0, 5.0);
    std::printf("angle = %.2f, torque = %.2f\n", angle.get(), torque.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g bv_basic.cpp -o bv_basic
$ ./bv_basic
angle = 1.20, torque = 3.00
```

(g++ 13.3 실측.) 결과는 `dup_classes.cpp`와 완전히 같은데, 클래스 정의는 하나뿐이다. 눈여겨볼 것은 멤버 함수를 클래스 밖에서 정의하는 문법이다 — `T BoundedValue<T>::get() const`처럼 **함수 본문 앞에 `template<typename T>`를 매번 다시 붙이고**, 클래스 이름 자리에는 `BoundedValue`가 아니라 `BoundedValue<T>`를 쓴다. 이 두 조각을 빼먹으면 컴파일러는 이걸 별개의 일반 함수로 착각해 링크 에러를 낸다. [2.9](#/unique-ptr)에서 `unique_ptr`의 복사 생성자 에러 메시지가 `unique_ptr<_Tp, _Dp>::unique_ptr(const unique_ptr<_Tp, _Dp>&)`처럼 나왔던 것이 바로 이 문법으로 실제 표준 라이브러리 헤더에 적힌 코드다. `std::unique_ptr<int>`를 쓰는 순간 컴파일러는 이 파일의 `check()`와 같은 자리에서 `T`를 요청받은 타입으로 갈아 끼워 새 클래스를 그 자리에서 만들어 낸다 — 그 인스턴스화 절차는 [4.3](#/template-mechanics)에서 다룬다.

::: tip 클래스 템플릿은 왜 헤더에 통째로 있어야 하는가
`.cpp`에 구현을 두고 `.hpp`에 선언만 두는 일반적인 분리는 클래스 템플릿에는 그대로 안 통한다 — 컴파일러가 `T`가 무엇인지 아는 시점(사용하는 쪽 번역 단위)에 정의 전체를 봐야 그 자리에서 인스턴스화할 수 있기 때문이다. [4.1](#/function-templates)이 함수 템플릿에 대해 이미 답한 것과 같은 이유다. 그래서 `bounded_value.hpp` 하나에 선언과 정의를 전부 넣었다.
:::

## 템플릿 매개변수 여러 개와 기본 인자

값의 타입과 한계값의 타입이 항상 같아야 하는 것은 아니다. 예를 들어 값은 `float`로 촘촘히 저장하고 한계값은 설정 파일에서 읽은 `double`로 받는 경우가 있다. 템플릿 매개변수는 콤마로 여러 개 나열할 수 있고, 뒤쪽 매개변수에는 함수의 기본 인자처럼 기본값을 줄 수 있다.

```cpp title="multiparam.hpp — 매개변수 두 개, 기본 인자 하나"
#ifndef MULTIPARAM_HPP
#define MULTIPARAM_HPP

#include <stdexcept>

// T: 값의 타입, Limit: 한계값의 타입 -- 지정하지 않으면 T와 같다고 가정한다
template<typename T, typename Limit = T>
class BoundedValue2 {
public:
    BoundedValue2(T value, Limit min, Limit max)
        : value_(value), min_(min), max_(max) {
        check();
    }
    T get() const { return value_; }
private:
    void check() const {
        if (value_ < min_ || value_ > max_) {
            throw std::out_of_range("BoundedValue2 out of range");
        }
    }
    T value_;
    Limit min_;
    Limit max_;
};

#endif
```

```cpp title="bv_multiparam.cpp"
#include <cstdio>
#include "multiparam.hpp"

int main() {
    BoundedValue2<double> a(1.2, -1.57, 1.57);           // Limit 생략 -- T와 같은 double로 채워진다
    BoundedValue2<float, double> b(1.2f, -1.57, 1.57);   // T=float, Limit=double 명시
    std::printf("a = %.2f, b = %.2f\n", a.get(), b.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g bv_multiparam.cpp -o bv_multiparam
$ ./bv_multiparam
a = 1.20, b = 1.20
```

(g++ 13.3 실측.) `BoundedValue2<double>`처럼 매개변수를 하나만 써도 컴파일이 통과한다 — 기본 인자 `Limit = T`가 나머지를 `double`로 채웠기 때문이다. 기본 인자는 뒤쪽 매개변수에만 줄 수 있고, 한 번 등장하면 그 뒤 모든 매개변수도 기본값을 가져야 한다 — [1.6 함수](#/functions)의 기본 인자 규칙과 같다.

## 전체 특수화: 일반 구현이 말이 안 되는 타입을 다시 짠다

`BoundedValue<T>`를 `bool`에 그대로 적용하면 무슨 일이 벌어지는지 실측해 본다.

```cpp title="bv_bool_before.cpp — 컴파일은 되지만 설계가 이상하다"
#include <cstdio>
#include "bounded_value.hpp"

int main() {
    BoundedValue<bool> flag(true, false, true);   // min/max가 bool이라는 것 자체가 의미 없다
    std::printf("flag = %d\n", flag.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g bv_bool_before.cpp -o bv_bool_before
$ ./bv_bool_before
flag = 1
```

(g++ 13.3 실측.) 컴파일은 통과한다 — `bool`도 `<`, `>` 비교가 가능해서다. 하지만 호출자는 `true`/`false` 하나만 표현하고 싶은데 매번 의미 없는 `min`, `max` 두 인자를 억지로 채워 넣어야 한다. 값의 범위라는 개념 자체가 `bool`에는 성립하지 않는다 — 이럴 때 `T = bool`인 경우만 따로, 완전히 새로운 구현으로 갈아치우는 것이 **전체 특수화(full specialization)**다.

```cpp title="bounded_value_bool.hpp — template<> 로 T=bool을 통째로 다시 정의한다"
#ifndef BOUNDED_VALUE_BOOL_HPP
#define BOUNDED_VALUE_BOOL_HPP

#include "bounded_value.hpp"

// 전체 특수화: T = bool일 때는 min/max 개념 자체가 없다 -- 값 하나만 받는다
template<>
class BoundedValue<bool> {
public:
    explicit BoundedValue(bool value) : value_(value) {}
    bool get() const { return value_; }
    void set(bool v) { value_ = v; }
private:
    bool value_;
};

#endif
```

```cpp title="bv_bool_after.cpp"
#include <cstdio>
#include "bounded_value_bool.hpp"

int main() {
    BoundedValue<bool> flag(true);   // 인자 하나 -- min/max가 없다
    std::printf("flag = %d\n", flag.get());
    flag.set(false);
    std::printf("flag = %d\n", flag.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g bv_bool_after.cpp -o bv_bool_after
$ ./bv_bool_after
flag = 1
flag = 0
```

(g++ 13.3 실측.) `template<>`(빈 꺾쇠)로 시작하고 클래스 이름 뒤에 `<bool>`을 못박으면, 그 안은 일반 템플릿과 아무 관계 없는 완전히 별개의 클래스다 — 멤버 함수, 생성자, 데이터 멤버를 전부 처음부터 다시 쓴다. 실제로 인터페이스 자체가 바뀌었다는 것을 컴파일러가 강제한다.

```cpp title="bv_bool_fail.cpp — 특수화된 버전엔 3인자 생성자가 없다"
#include "bounded_value_bool.hpp"

int main() {
    BoundedValue<bool> flag(true, false, true);   // 일반 버전의 생성자를 그대로 기대하면 안 된다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g bv_bool_fail.cpp -o bv_bool_fail
bv_bool_fail.cpp: In function 'int main()':
bv_bool_fail.cpp:4:46: error: no matching function for call to
    'BoundedValue<bool>::BoundedValue(bool, bool, bool)'
    4 |     BoundedValue<bool> flag(true, false, true);
      |                                              ^
bounded_value_bool.hpp:10:14: note: candidate:
    'BoundedValue<bool>::BoundedValue(bool)'
   10 |     explicit BoundedValue(bool value) : value_(value) {}
      |              ^~~~~~~~~~~~
bounded_value_bool.hpp:10:14: note:   candidate expects 1 argument, 3 provided
```

(g++ 13.3 실측.) 에러가 정확히 "1개 인자를 기대하는데 3개를 줬다"고 짚는다 — `BoundedValue<bool>`은 이제 원래 템플릿과 생김새가 다른 별도의 클래스이기 때문이다. 전체 특수화는 "같은 이름을 쓰지만 사실상 다른 클래스를 쓰겠다"는 선언이지, 일반 버전의 부분적인 변형이 아니다.

## 부분 특수화: 포인터 타입에만 다른 규칙을 준다

전체 특수화는 정확히 하나의 타입(`bool`)을 겨냥한다. 반면 "포인터 타입이면 전부", "배열 타입이면 전부"처럼 **타입의 패턴**을 겨냥하고 싶을 때는 **부분 특수화(partial specialization)**를 쓴다. 포인터를 담는 `BoundedValue<T*>`는 값 자체의 범위가 아니라 "가리키는 대상이 `nullptr`인가"를 검사하는 게 자연스럽다.

```cpp title="bv_ptr.hpp — 부분 특수화: T* 패턴 전체를 겨냥한다"
#ifndef BV_PTR_HPP
#define BV_PTR_HPP

#include <stdexcept>
#include "bounded_value.hpp"

// 부분 특수화: T가 무엇이든 "포인터"이기만 하면 이 버전이 선택된다
template<typename T>
class BoundedValue<T*> {
public:
    BoundedValue(T* value, T* /*min*/, T* /*max*/) : value_(value) {
        if (value_ == nullptr) {
            throw std::invalid_argument("BoundedValue<T*> got nullptr");
        }
    }
    T* get() const { return value_; }
private:
    T* value_;
};

#endif
```

```cpp title="bv_ptr_test.cpp"
#include <cstdio>
#include "bv_ptr.hpp"

int main() {
    int x = 42;
    int y = 0;
    BoundedValue<int*> p(&x, &y, &y);   // T = int로 추론되고, T* 특수화가 선택된다
    std::printf("*p.get() = %d\n", *p.get());

    try {
        BoundedValue<int*> bad(nullptr, &y, &y);
    } catch (const std::exception& e) {
        std::printf("잡은 예외: %s\n", e.what());
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g bv_ptr_test.cpp -o bv_ptr_test
$ ./bv_ptr_test
*p.get() = 42
잡은 예외: BoundedValue<T*> got nullptr
```

(g++ 13.3 실측.) 여전히 매개변수는 `T` 하나뿐이다 — 전체 특수화처럼 `T`를 확정하는 게 아니라, `BoundedValue<T*>`라는 **형태(패턴)**를 특수화 대상으로 잡았다. `BoundedValue<int*>`를 쓰면 컴파일러는 일반 버전(`BoundedValue<T>`)과 포인터 버전(`BoundedValue<T*>`) 중 더 구체적으로 일치하는 쪽 — 포인터 버전 — 을 고른다. 일반 버전, `bool` 전체 특수화, `T*` 부분 특수화 세 가지가 같은 헤더 묶음 안에 동시에 존재해도 서로 충돌하지 않는다는 것도 확인해 둔다.

```cpp title="combined_all.hpp — 세 버전을 한 헤더에 모은다"
#ifndef COMBINED_ALL_HPP
#define COMBINED_ALL_HPP

#include <stdexcept>

// ① 일반 템플릿
template<typename T>
class BoundedValue {
public:
    BoundedValue(T value, T min, T max) : value_(value), min_(min), max_(max) {
        if (value_ < min_ || value_ > max_) throw std::out_of_range("out of range");
    }
    T get() const { return value_; }
private:
    T value_, min_, max_;
};

// ② 전체 특수화 -- T = bool
template<>
class BoundedValue<bool> {
public:
    explicit BoundedValue(bool value) : value_(value) {}
    bool get() const { return value_; }
private:
    bool value_;
};

// ③ 부분 특수화 -- T가 포인터(T*)
template<typename T>
class BoundedValue<T*> {
public:
    BoundedValue(T* value, T*, T*) : value_(value) {
        if (value_ == nullptr) throw std::invalid_argument("nullptr");
    }
    T* get() const { return value_; }
private:
    T* value_;
};

#endif
```

```cpp title="combined_test.cpp — 세 버전이 한 프로그램 안에 공존한다"
#include <cstdio>
#include "combined_all.hpp"   // 일반 템플릿 + bool 전체 특수화 + T* 부분 특수화를 모두 담은 헤더

int main() {
    BoundedValue<double> angle(1.2, -1.57, 1.57);   // ① 일반 버전
    BoundedValue<bool> flag(true);                   // ② bool 전체 특수화
    int x = 7;
    BoundedValue<int*> ptr(&x, nullptr, nullptr);    // ③ 포인터 부분 특수화

    std::printf("angle = %.2f\n", angle.get());
    std::printf("flag = %d\n", flag.get());
    std::printf("*ptr = %d\n", *ptr.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g combined_test.cpp -o combined_test
$ ./combined_test
angle = 1.20
flag = 1
*ptr = 7
```

(g++ 13.3 실측.) `BoundedValue<double>`, `BoundedValue<bool>`, `BoundedValue<int*>` 세 줄이 각각 다른 구현으로 조용히 갈라져 들어간다 — 호출하는 쪽은 어느 버전이 선택됐는지 신경 쓸 필요가 없다.

::: warn 함수 템플릿에는 부분 특수화가 없다
클래스 템플릿과 달리 **함수 템플릿은 부분 특수화를 지원하지 않는다.** `template<typename T> void process(T*)`처럼 포인터만 따로 다루고 싶으면 부분 특수화 문법이 아니라 **오버로딩**으로 해결한다 — `template<typename T> void process(T)`와 `template<typename T> void process(T*)`를 나란히 선언하면, 오버로드 해석이 더 구체적인 쪽(`T*`)을 우선 고른다. 이 차이는 표준위원회가 함수 템플릿의 부분 특수화를 허용하면 오버로드 해석 규칙과 특수화 선택 규칙이 겹쳐 어느 쪽이 이기는지 예측하기 어려워진다고 판단해 아예 막아 둔 것이다 — 함수는 오버로딩이라는 이미 있는 도구로 같은 효과를 낼 수 있으니 새 규칙을 더할 필요가 없었다.
:::

## 별칭 템플릿: using으로 이름만 새로 붙인다

로봇 코드에서는 `BoundedValue<T>`보다 `JointValue<T>`라는 이름이 의도를 더 잘 드러낼 때가 있다. 완전히 새 클래스를 만드는 대신, **별칭 템플릿(alias template)**으로 이름만 새로 지어 준다.

```cpp title="alias_test.cpp — template<typename T> using"
#include <cstdio>
#include "bounded_value.hpp"

// 별칭 템플릿 -- T는 여전히 열려 있다. BoundedValue<T>와 완전히 같은 타입이다
template<typename T>
using JointValue = BoundedValue<T>;

int main() {
    JointValue<double> angle(1.2, -1.57, 1.57);   // JointValue<double> == BoundedValue<double>
    std::printf("angle = %.2f\n", angle.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g alias_test.cpp -o alias_test
$ ./alias_test
angle = 1.20
```

(g++ 13.3 실측.) `JointValue<double>`은 `BoundedValue<double>`과 이름만 다를 뿐 완전히 같은 타입이다 — 새 클래스가 생긴 게 아니라 컴파일러 입장에서 그냥 별명이다. 옛 C++의 `typedef`로는 이걸 못 한다는 것을 실측해 본다.

```cpp title="typedef_fail.cpp — typedef는 T를 남긴 채로 이름 붙일 수 없다"
#include "bounded_value.hpp"

// typedef는 템플릿 매개변수를 "부분적으로" 가릴 수 없다 -- T가 이 시점에 이미 확정돼야 한다
typedef BoundedValue<T> JointValueTypedef;

int main() {
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g typedef_fail.cpp -o typedef_fail
typedef_fail.cpp:4:22: error: 'T' was not declared in this scope
    4 | typedef BoundedValue<T> JointValueTypedef;
      |                      ^
typedef_fail.cpp:4:23: error: template argument 1 is invalid
    4 | typedef BoundedValue<T> JointValueTypedef;
      |                       ^
```

(g++ 13.3 실측.) `typedef`는 이미 완전히 확정된 타입 하나에만 이름을 붙일 수 있다 — `T`가 아직 정해지지 않았다는 것 자체를 표현할 문법이 없다. 그래서 컴파일러는 `T`를 어딘가에 선언된 적 있는 보통의 타입 이름으로 착각하고 "그런 이름 없다"는 에러를 낸다. `template<typename T> using ... = ...`은 정확히 이 빈틈을 메우려고 C++11에 추가된 문법이다 — "타입 매개변수 하나를 아직 열어 둔 채로 별명을 만든다"는 것을 표현할 방법이 그전에는 없었다.

## CTAD: 클래스 템플릿 인자 추론 (C++17)

지금까지 모든 예제는 `BoundedValue<double>`처럼 꺾쇠 안에 타입을 명시했다. C++17부터는 함수 템플릿의 인자 추론과 똑같은 원리로, 생성자 인자만 보고 클래스 템플릿의 `T`를 컴파일러가 추론해 준다 — **클래스 템플릿 인자 추론(Class Template Argument Deduction, CTAD)**이다.

```cpp title="ctad_test.cpp — <double>을 쓰지 않았다"
#include <cstdio>
#include "bounded_value.hpp"

int main() {
    BoundedValue angle(3.0, 0.0, 100.0);   // <double>이 없다 -- 컴파일러가 추론한다
    std::printf("angle = %.2f\n", angle.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g ctad_test.cpp -o ctad_test
$ ./ctad_test
angle = 3.00
```

(g++ 13.3 실측.) 세 인자가 전부 `double`이라 컴파일러가 `T = double`로 확정한다. 인자 타입이 서로 다르면 어떻게 되는지 실측해 본다.

```cpp title="ctad_fail.cpp — 세 인자의 타입이 갈라지면 추론이 실패한다"
#include "bounded_value.hpp"

int main() {
    BoundedValue angle(3.0, 0, 100);   // 3.0은 double, 0과 100은 int -- T가 하나로 안 모인다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g ctad_fail.cpp -o ctad_fail
ctad_fail.cpp: In function 'int main()':
ctad_fail.cpp:4:35: error: class template argument deduction failed:
    4 |     BoundedValue angle(3.0, 0, 100);
      |                                   ^
ctad_fail.cpp:4:35: error: no matching function for call to 'BoundedValue(double, int, int)'
bounded_value.hpp:20:1: note: candidate:
    'template<class T> BoundedValue(T, T, T)-> BoundedValue<T>'
bounded_value.hpp:20:1: note:   deduced conflicting types for parameter 'T' ('double' and 'int')
```

(g++ 13.3 실측.) 에러 메시지에 `BoundedValue(T, T, T) -> BoundedValue<T>`라는 낯선 줄이 보인다 — 이것이 **추론 가이드(deduction guide)**다. 사용자가 하나도 쓰지 않았는데도 컴파일러가 생성자 시그니처(`BoundedValue(T, T, T)`)로부터 **암묵적으로** 만들어 낸 것이다. 세 인자가 전부 같은 `T`여야 한다는 이 암묵적 가이드로는 `double`과 `int`가 섞인 호출을 추론할 수 없어 실패했다. 이럴 때는 추론 가이드를 직접 하나 써서 규칙을 바꿀 수 있다.

```cpp title="ctad_guide2.cpp — 명시적 추론 가이드로 규칙을 바꾼다"
#include <cstdio>
#include "bounded_value.hpp"

// 추론 가이드 -- 첫 인자의 타입 T로 확정하고, 나머지 둘은 U로 받아도 결과는 BoundedValue<T>다
template<typename T, typename U>
BoundedValue(T, U, U) -> BoundedValue<T>;

int main() {
    BoundedValue angle(3.0f, 0.0, 100.0);   // T=float, U=double -- 가이드 없이는 컴파일 에러였다
    std::printf("angle = %.2f\n", angle.get());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g ctad_guide2.cpp -o ctad_guide2
$ ./ctad_guide2
angle = 3.00
```

(g++ 13.3 실측.) 추론 가이드는 생성자 자체를 바꾸지 않는다 — "이런 인자 패턴이 오면 `T`를 이렇게 결정해라"는 규칙만 컴파일러에 추가로 알려준다. 이 절에서는 여기까지만 본다 — 추론 가이드가 여러 개 겹쳐 경쟁할 때의 우선순위, 표준 라이브러리 컨테이너들이 미리 준비해 둔 가이드는 STL을 다루는 [Part V](#/vector)에서 실제 컨테이너로 다시 만난다.

::: hist C++17 이전에는 팩토리 함수로 이 문제를 피해 갔다
CTAD가 없던 시절, `std::pair<int, double>{1, 2.0}` 대신 `std::make_pair(1, 2.0)`을 썼다 — 함수 템플릿은 이미 인자로 타입을 추론했으니 클래스 대신 함수를 하나 더 만들어 그 능력을 빌린 것이다. `std::make_unique`가 지금도 살아 있는 이유는 타입 추론이 아니라 [2.9](#/unique-ptr)에서 본 예외 안전성 때문이다 — CTAD는 그 문제를 대신 풀어 주지 않는다.
:::

## 로봇 도메인: 값 래퍼의 통일, 그리고 std::array의 숨은 매개변수

`BoundedValue<double>` 하나로 관절 각도, 관절 토크, 관절 속도, 관절 전류를 전부 표현하면 하드웨어 추상화 계층의 타입이 하나로 정리된다 — `ros2_control`의 `hardware_interface`가 각 관절의 상태·명령을 주고받을 때, 값마다 매번 새 클래스를 만드는 대신 이런 통일된 값 래퍼 템플릿 하나면 충분하다. rclcpp도 같은 패턴을 훨씬 큰 규모로 쓴다 — `create_publisher<std_msgs::msg::Float64>(...)`가 실제로 만드는 것은 `rclcpp::Publisher<MessageT>`라는 클래스 템플릿의 인스턴스다. [10.2 토픽](#/pub-sub)에서 이 퍼블리셔가 메시지 타입마다 어떻게 인스턴스화되는지 직접 확인한다.

`T`가 값의 자료형이었다면, 템플릿 매개변수 자리에 **타입이 아니라 정수**가 들어갈 수도 있다는 것을 [4.1](#/function-templates)이 이미 예고했다 — **비타입 템플릿 매개변수(non-type template parameter)**다. `std::array<T, N>`이 정확히 이 형태다. `N`은 함수 인자가 아니라 템플릿 매개변수라서, 크기가 다른 `array`는 컴파일 타임에 이미 서로 다른 타입이다.

```cpp title="array_ntp.cpp — N은 타입의 일부다"
#include <array>
#include <cstdio>
#include <typeinfo>

int main() {
    std::array<double, 3> leg1_angles{0.1, 0.2, 0.3};
    std::array<double, 4> other_size{1.0, 2.0, 3.0, 4.0};

    std::printf("sizeof(leg1_angles) = %zu\n", sizeof(leg1_angles));
    std::printf("sizeof(other_size)  = %zu\n", sizeof(other_size));
    std::printf("같은 타입인가: %s\n",
        (typeid(leg1_angles) == typeid(other_size)) ? "true" : "false");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g array_ntp.cpp -o array_ntp
$ ./array_ntp
sizeof(leg1_angles) = 24
sizeof(other_size)  = 32
같은 타입인가: false
```

(g++ 13.3 실측.) `std::array<double, 3>`과 `std::array<double, 4>`는 원소 타입이 같아도 서로 다른 타입이다 — `sizeof`가 각각 8바이트(double 하나)의 3배, 4배로 정확히 갈린다. 이 성질은 함수 시그니처에서 크기 실수를 컴파일 타임에 바로 잡아낸다.

```cpp title="array_ntp_fail.cpp — 다리 세 관절 함수에 네 개짜리 배열을 넘기면"
#include <array>

void set_leg_angles(std::array<double, 3>& angles);

int main() {
    std::array<double, 4> wrong_size{1.0, 2.0, 3.0, 4.0};
    set_leg_angles(wrong_size);   // N이 다르므로 애초에 다른 타입 -- 컴파일 에러
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g array_ntp_fail.cpp -o array_ntp_fail
array_ntp_fail.cpp: In function 'int main()':
array_ntp_fail.cpp:7:20: error: invalid initialization of reference of type
    'std::array<double, 3>&' from expression of type 'std::array<double, 4>'
    7 |     set_leg_angles(wrong_size);
      |                    ^~~~~~~~~~
```

(g++ 13.3 실측.) 원소 개수가 맞지 않는 배열을 넘기는 실수가 런타임 인덱스 초과가 아니라 **링크 이전, 컴파일 단계**에서 걸린다 — 관절 개수가 코드 전체에서 하나로 고정된 로봇 다리 같은 도메인에 정확히 맞는 안전장치다. Eigen의 `Matrix<double, Rows, Cols>`도 같은 비타입 매개변수 구조를 행과 열 각각에 적용한 것이다. [9.1 Eigen](#/eigen)에서 행렬 크기가 안 맞는 곱셈을 컴파일 타임에 잡아내는 것을 실측으로 확인한다.

::: interview 클래스 템플릿의 전체 특수화와 부분 특수화 차이
**질문**: 전체 특수화와 부분 특수화는 무엇이 다른가?

**모범 답변 뼈대**: 전체 특수화(`template<> class Foo<Bar>`)는 템플릿 매개변수를 하나도 남기지 않고 **정확히 하나의 구체적인 타입 조합**을 겨냥한다 — 이 절의 `BoundedValue<bool>`처럼, 결과는 원본 템플릿과 인터페이스가 달라도 되는 완전히 별개의 클래스다. 부분 특수화(`template<typename T> class Foo<T*>`)는 매개변수를 일부 남긴 채로 **타입의 패턴**(포인터, 배열, 다른 템플릿의 인스턴스 등)을 겨냥한다 — 여전히 열린 매개변수가 있으므로 "특수화됐지만 여전히 템플릿"이다. 실무 신호: 함수 템플릿은 부분 특수화를 지원하지 않고 오버로딩으로 대체한다는 것도 같이 짚으면 이해도가 더 잘 드러난다.
:::

## 요약

- 클래스 템플릿은 `template<typename T> class X { ... }`로 선언하고, 클래스 밖에서 멤버를 정의할 때는 함수마다 `template<typename T>`를 다시 붙이고 클래스 이름에 `<T>`를 명시한다(실측) — `std::unique_ptr<_Tp, _Dp>`의 실제 헤더 코드가 이 문법 그대로다.
- 템플릿 매개변수는 콤마로 여러 개 나열할 수 있고, 함수의 기본 인자와 같은 규칙으로 뒤쪽 매개변수에 기본값(`typename Limit = T`)을 줄 수 있다(실측).
- 전체 특수화(`template<> class X<Bool>`)는 정확히 하나의 타입을 겨냥해 인터페이스까지 완전히 새로 짜는 별개의 클래스를 만든다 — 일반 버전의 생성자를 기대하면 컴파일 에러로 걸린다(실측).
- 부분 특수화(`template<typename T> class X<T*>`)는 매개변수를 일부 남긴 채 타입의 패턴(포인터 등)을 겨냥한다 — 함수 템플릿에는 이 문법이 없고 오버로딩으로 대체한다.
- 별칭 템플릿(`template<typename T> using Y = X<T>`)은 매개변수를 열어 둔 채로 이름만 새로 붙인다 — `typedef`는 이미 확정된 타입에만 이름을 붙일 수 있어 이 역할을 하지 못한다(실측).
- CTAD(C++17)는 생성자 인자로 클래스 템플릿의 `T`를 추론한다 — 암묵적 추론 가이드는 생성자 시그니처에서 자동 생성되고, 그걸로 부족하면 추론 가이드를 직접 써서 규칙을 보충한다(실측).
- `std::array<T, N>`의 `N`은 비타입 템플릿 매개변수라 크기가 다르면 애초에 다른 타입이다 — 크기 불일치가 런타임이 아니라 컴파일 타임에 걸린다(실측). Eigen의 고정 크기 행렬도 같은 구조다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일해서 확인하는 실습이다.

1. `BoundedValue<bool>`(전체 특수화)과 `BoundedValue<T*>`(부분 특수화)는 매개변수 목록이 각각 어떻게 다른가. 이 절의 어떤 컴파일 에러가 그 차이를 실제로 보여줬는가.

2. 함수 템플릿에는 왜 부분 특수화가 없는가 — 대신 무엇을 쓰는가.

3. (실습, 코드 작성형) `T = std::string`일 때는 min/max 대신 "최대 길이"만 검사하는 전체 특수화를 직접 짜라. 성공 기준: 경고 없이 컴파일되고, 최대 길이를 넘는 문자열을 넣으면 예외가 던져지는 것을 실행해서 확인했다.

4. (실습, 코드 작성형) `template<typename T> using JointValue = BoundedValue<T>;`를 직접 쳐서 `typeid(JointValue<double>) == typeid(BoundedValue<double>)`가 `true`임을 확인하라. 그다음 같은 것을 `typedef`로 시도해 `T`가 미확정이라 에러가 나는 것도 재현하라.

5. (실습, 코드 작성형) `BoundedValue angle(3.0, 0, 100);`처럼 인자 타입이 섞인 CTAD 호출을 먼저 실패시켜 보고, `ctad_guide2.cpp`와 같은 추론 가이드를 직접 써서 통과하도록 고쳐라. 성공 기준: 가이드 추가 전 `deduced conflicting types` 에러를 봤고, 추가 후 같은 코드가 통과하는 것을 확인했다.
:::

::: answer 해설
1. 전체 특수화 `BoundedValue<bool>`은 `template<>`로 시작해 남은 매개변수가 없다 — 클래스 이름도 `BoundedValue<bool>`처럼 타입이 완전히 확정돼 있다. 부분 특수화 `BoundedValue<T*>`는 `template<typename T>`로 시작해 `T`가 여전히 열려 있고, 클래스 이름은 패턴만 확정돼 있다. `bv_bool_fail.cpp`의 "1개 인자를 기대하는데 3개 받았다"는 에러는 전자가 별개 클래스라 생긴 것이고, `bv_ptr_test.cpp`가 `T = int`를 그대로 추론한 것은 후자가 여전히 템플릿이기 때문이다.
2. 함수 템플릿에 부분 특수화를 허용하면 오버로드 해석 규칙과 특수화 선택 규칙이 겹쳐 우선순위가 예측하기 어려워진다 — 그래서 금지됐다. 대신 오버로딩으로 같은 효과를 낸다 — `f(T)`와 `f(T*)`를 나란히 선언하면 더 구체적인 `T*` 버전이 우선 선택된다.
3. `template<> class BoundedValue<std::string> { ... }` 형태로 짜고, 생성자에서 `value.size() > max_len_`이면 `std::out_of_range`를 던지면 된다. min에 해당하는 개념은 보통 없으므로 최대 길이 하나만 받는 생성자로 인터페이스 자체를 바꿔도 된다 — 전체 특수화는 인터페이스를 다시 설계할 자유를 준다.
4. `JointValue<double>`과 `BoundedValue<double>`은 별칭 템플릿이 만든 완전히 같은 타입이라 `typeid` 비교가 `true`를 낸다. `typedef BoundedValue<T> X;` 형태로 짜면 `T`가 선언되지 않았다는 `'T' was not declared in this scope` 에러가 그대로 재현된다 — typedef는 매개변수를 열어 둔 채로 이름 붙일 문법이 없다.
5. 가이드 추가 전에는 `error: deduced conflicting types for parameter 'T' ('double' and 'int')`가 뜬다 — 암묵적 추론 가이드가 세 인자 모두 같은 `T`를 요구하기 때문이다. `template<typename T, typename U> BoundedValue(T, U, U) -> BoundedValue<T>;`를 추가하면 첫 인자 타입만 `T`로 확정하는 새 규칙이 생겨, 인자 타입이 섞여도 컴파일이 통과한다.
:::

이 절의 헤더 파일(`bounded_value.hpp`, `bounded_value_bool.hpp`, `bv_ptr.hpp`)과 각 테스트 파일을 전부 직접 쳐라. 특히 `bv_bool_fail.cpp`와 `ctad_fail.cpp`는 일부러 실패하는 코드다 — 에러 메시지를 두 눈으로 보고, 그다음 고친 버전을 옆에 두고 비교해라. 전체 실습은 `g++ -std=c++20 -Wall -Wextra -g main.cpp -o main && ./main`으로 돌린다.

**다음 절**: [4.3 템플릿 인스턴스화의 실체](#/template-mechanics) — 컴파일러가 `BoundedValue<double>`을 요청받는 순간 실제로 무슨 일이 일어나는지, 왜 같은 템플릿을 여러 번역 단위에서 쓰면 코드가 중복 생성되는지, 그리고 그 링크 에러 메시지를 해독하는 법을 실측으로 확인한다.
