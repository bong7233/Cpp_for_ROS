# 3.6 연산자 오버로딩

::: lead
[3.5](#/abstract-interfaces)까지는 함수 호출로 객체를 다뤘다. 그런데 `Vector2`처럼 수학적으로 이미 익숙한 값 타입은 `add(a, b)`보다 `a + b`가 코드를 읽는 사람의 머릿속 모델과 더 가깝다 — 헥사포드 다리 오프셋을 몸체 위치에 더하는 계산이 로봇 코드 전체에 수백 번 등장한다면, 그 차이는 사소하지 않다. 이 절은 `+`, `-`, `*`, `==`, `<<` 같은 익숙한 기호를 사용자 타입에 붙이는 문법 — 연산자 오버로딩 — 을 다룬다. 멤버 함수로 쓸지 자유 함수로 쓸지는 취향이 아니라 "왼쪽 피연산자에 암묵 변환이 필요한가"로 갈리는 문제이고, C++20의 삼중 비교 연산자 `<=>`는 [2.6](#/copy-semantics)·[2.8](#/rule-of-five)에서 본 `=default`를 비교 연산 전체로 확장한다. 마지막은 절제의 문제다 — 이 기호들을 아무 데나 붙이면 코드가 무엇을 하는지 예측할 수 없어진다.
:::

## add(a, b)와 a + b — 같은 계산, 다른 코드

헥사포드 다리 하나의 목표 위치는 몸체 좌표에 다리 오프셋을 더하고, 지형 보정값을 한 번 더 더해서 나온다. `Vector2`를 순수 구조체로 두고 자유 함수 `add`로 계산을 표현하면 이렇다.

```cpp title="01_add_fn.cpp — 함수 호출로 표현한 벡터 덧셈"
#include <cstdio>

struct Vector2 {
    double x, y;
};

Vector2 add(const Vector2& a, const Vector2& b) {
    return {a.x + b.x, a.y + b.y};
}

int main() {
    Vector2 leg_offset{0.12, -0.05};
    Vector2 body_pos{1.30, 0.44};

    Vector2 target = add(add(body_pos, leg_offset), Vector2{0.0, 0.02});
    std::printf("target = (%.2f, %.2f)\n", target.x, target.y);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 01_add_fn.cpp -o 01_add_fn
$ ./01_add_fn
target = (1.42, 0.41)
```

계산은 맞다. 그런데 `add(add(body_pos, leg_offset), Vector2{0.0, 0.02})`를 눈으로 훑을 때, 어느 괄호가 어느 덧셈에 대응하는지 한 번에 안 들어온다. 세 항을 더하는 표현식일 뿐인데 코드는 함수 호출의 중첩 구조를 먼저 해독하게 만든다. `operator+`를 정의하면 같은 계산이 이렇게 바뀐다.

```cpp title="01b_add_op.cpp — operator+로 표현한 같은 계산"
#include <cstdio>

struct Vector2 {
    double x, y;
};

Vector2 operator+(const Vector2& a, const Vector2& b) {
    return {a.x + b.x, a.y + b.y};
}

int main() {
    Vector2 leg_offset{0.12, -0.05};
    Vector2 body_pos{1.30, 0.44};

    Vector2 target = body_pos + leg_offset + Vector2{0.0, 0.02};
    std::printf("target = (%.2f, %.2f)\n", target.x, target.y);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 01b_add_op.cpp -o 01b_add_op
$ ./01b_add_op
target = (1.42, 0.41)
```

결과는 완전히 같은 `(1.42, 0.41)`이다 — 두 코드는 정확히 같은 계산을 한다. 다른 건 읽는 사람이 지불하는 해독 비용이다. `body_pos + leg_offset + Vector2{0.0, 0.02}`는 `+`가 왼쪽에서 오른쪽으로 결합한다는, 초등학교 산수부터 이미 몸에 있는 규칙을 그대로 쓴다. **연산자 오버로딩의 정당한 자리는 딱 여기다** — 대상 타입이 수학적으로 이미 "더한다"는 연산을 자연스럽게 갖고 있고, 그 연산을 기호로 표현했을 때 독자가 새로 배울 게 없는 경우. `Vector2`가 정확히 그런 타입이다. 반대로 "이 타입에 `+`가 뭘 하는지 문서를 봐야 안다"면, 그 타입에는 `+`를 붙이면 안 된다 — 이 기준은 §6에서 다시 정확하게 정리한다.

## 멤버 함수로 쓸 때와 자유 함수로 쓸 때

`operator+`를 `Vector2`의 멤버 함수로 선언할 수도 있다.

```cpp title="02_member_asymmetry.cpp — 멤버 operator+는 왼쪽 피연산자가 고정된다"
#include <cstdio>

struct Vector2 {
    double x, y;

    Vector2(double s = 0.0) : x(s), y(s) {}      // 암묵 변환용 -- 스칼라를 (s, s)로 넓힌다
    Vector2(double xi, double yi) : x(xi), y(yi) {}

    // 멤버 함수 -- 왼쪽 피연산자는 반드시 Vector2 자신이다
    Vector2 operator+(const Vector2& rhs) const {
        return Vector2(x + rhs.x, y + rhs.y);
    }
};

int main() {
    Vector2 a(1.0, 2.0);

    Vector2 b = a + 5.0;    // OK -- 오른쪽 피연산자만 Vector2(double)로 변환되면 된다
    std::printf("a + 5.0 = (%.1f, %.1f)\n", b.x, b.y);

    Vector2 c = 5.0 + a;    // 왼쪽 피연산자가 double이라 멤버 operator+를 찾을 방법이 없다
    std::printf("5.0 + a = (%.1f, %.1f)\n", c.x, c.y);
    return 0;
}
```

`Vector2(double s)`는 스칼라 하나를 `(s, s)`로 퍼뜨리는 암묵 변환 생성자다 — `explicit`을 안 붙였으니 [3.2](#/constructors)에서 본 대로 `double`이 필요한 자리에 `Vector2`가 조용히 끼어든다. `a + 5.0`은 문제없이 컴파일된다 — `operator+`가 `rhs`를 `const Vector2&`로 받으니 `5.0`이 `Vector2(5.0)`으로 변환돼 들어간다. 그런데 `5.0 + a`는 다르다.

```console
$ g++ -std=c++20 -Wall -Wextra -c 02_member_asymmetry.cpp
02_member_asymmetry.cpp: In function 'int main()':
02_member_asymmetry.cpp:21:21: error: no match for 'operator+' (operand types are 'double' and 'Vector2')
   21 |     Vector2 c = 5.0 + a;    // 왼쪽 피연산자가 double이라 멤버 operator+를 찾을 방법이 없다
      |                 ~~~ ^ ~
      |                 |     |
      |                 |     Vector2
      |                 double
```

`a.operator+(b)`는 문법적으로 `a + b`의 정확한 번역이다 — **호출되는 멤버 함수는 항상 왼쪽 피연산자에 속한다.** `5.0 + a`를 이 형태로 옮기면 `5.0.operator+(a)`가 되는데, `double`에는 멤버 함수가 없다. 컴파일러는 왼쪽 피연산자(`double`)에서 시작해 오버로드 후보를 찾고, `Vector2::operator+`는 애초에 그 타입의 멤버 함수 목록에 없으니 후보에도 못 오른다 — 오른쪽 피연산자를 변환해서라도 맞춰 보려는 시도 자체가 일어나지 않는다. **암묵 변환은 오른쪽 피연산자에만 걸린다.** 이걸 고치려면 `operator+`가 클래스에 매이지 않은 자유 함수여야 한다.

```cpp title="03_free_symmetry.cpp — 자유 함수는 양쪽 다 변환 대상이 된다"
#include <cstdio>

struct Vector2 {
    double x, y;

    Vector2(double s = 0.0) : x(s), y(s) {}
    Vector2(double xi, double yi) : x(xi), y(yi) {}
};

// 자유 함수 -- 왼쪽·오른쪽 피연산자 둘 다 암묵 변환의 대상이 될 수 있다
Vector2 operator+(const Vector2& lhs, const Vector2& rhs) {
    return Vector2(lhs.x + rhs.x, lhs.y + rhs.y);
}

int main() {
    Vector2 a(1.0, 2.0);

    Vector2 b = a + 5.0;    // rhs가 double -> Vector2로 변환
    Vector2 c = 5.0 + a;    // lhs가 double -> Vector2로 변환 -- 이제 컴파일된다
    std::printf("a + 5.0 = (%.1f, %.1f)\n", b.x, b.y);
    std::printf("5.0 + a = (%.1f, %.1f)\n", c.x, c.y);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 03_free_symmetry.cpp -o 03_free_symmetry
$ ./03_free_symmetry
a + 5.0 = (6.0, 7.0)
5.0 + a = (6.0, 7.0)
```

이제 양쪽 다 통과하고 결과도 같다. `operator+(const Vector2&, const Vector2&)`는 어느 인자에도 소속되지 않아, 오버로드 해석이 왼쪽·오른쪽 인자 **둘 다**에 암묵 변환을 시도할 수 있다. **판단 기준은 하나다 — 이 연산자가 왼쪽·오른쪽 대칭이어야 하는가.** 대등한 두 피연산자를 다루는 연산(`+`, `-`, `==`)은 자유 함수로 쓴다. 반대로 `container[index]`처럼 왼쪽(자기 자신)이 연산의 주체이고 오른쪽에 변환이 걸릴 여지가 없는 연산은 멤버로 써도 된다 — §6의 `operator[]`가 그 예다. `operator=`, `operator[]`, `operator()`, `operator->`는 언어 규칙상 **반드시 멤버 함수**여야 한다는 것도 기억해 둔다.

private 멤버에 접근해야 하는 자유 함수는 `friend`로 접근을 열어야 할 때가 있다 — 뒤에서 볼 `operator<<`가 그 경우다. 다만 이 열쇠는 **최소한으로만** 쓴다. `Vector2`가 `x()`, `y()` 같은 public 접근자를 이미 제공한다면 자유 함수는 그 접근자만으로 충분하고 `friend`는 필요 없다 — 클래스 전체가 아니라 딱 그 함수 하나에만 예외를 준다는 것이 `friend`가 존재하는 이유다.

## 값 타입 연산자 세트: +, -, *, ==, !=

`Vector2`가 로봇 좌표 계산에서 실제로 필요로 하는 연산자를 한 벌 갖춘다 — 벡터끼리의 덧셈·뺄셈, 스칼라곱, 그리고 동등 비교다.

```cpp title="04_value_ops.cpp — Vector2의 값 타입 연산자 한 벌"
#include <cstdio>

struct Vector2 {
    double x, y;

    bool operator==(const Vector2&) const = default;   // 2.6/2.8에서 본 멤버별 비교를 컴파일러가 생성
};

Vector2 operator+(const Vector2& a, const Vector2& b) { return {a.x + b.x, a.y + b.y}; }
Vector2 operator-(const Vector2& a, const Vector2& b) { return {a.x - b.x, a.y - b.y}; }
Vector2 operator*(const Vector2& v, double s)         { return {v.x * s, v.y * s}; }
Vector2 operator*(double s, const Vector2& v)         { return v * s; }   // 좌우 대칭은 서로 위임해 만든다

int main() {
    Vector2 a{1.0, 2.0};
    Vector2 b{3.0, 4.0};

    Vector2 sum  = a + b;
    Vector2 diff = a - b;
    Vector2 scaled  = a * 2.0;
    Vector2 scaled2 = 2.0 * a;

    std::printf("a + b     = (%.1f, %.1f)\n", sum.x, sum.y);
    std::printf("a - b     = (%.1f, %.1f)\n", diff.x, diff.y);
    std::printf("a * 2.0   = (%.1f, %.1f)\n", scaled.x, scaled.y);
    std::printf("2.0 * a   = (%.1f, %.1f)\n", scaled2.x, scaled2.y);

    std::printf("a == a    : %s\n", (a == a) ? "true" : "false");
    std::printf("a == b    : %s\n", (a == b) ? "true" : "false");
    std::printf("a != b    : %s\n", (a != b) ? "true" : "false");   // != 는 == 로부터 컴파일러가 재작성
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 04_value_ops.cpp -o 04_value_ops
$ ./04_value_ops
a + b     = (4.0, 6.0)
a - b     = (-2.0, -2.0)
a * 2.0   = (2.0, 4.0)
2.0 * a   = (2.0, 4.0)
a == a    : true
a == b    : false
a != b    : true
```

두 가지가 눈여겨볼 만하다. 첫째, `2.0 * a`를 위해 별도 로직을 새로 짜지 않고 `a * 2.0`에 위임했다 — 스칼라곱은 좌우 어느 쪽에 와도 결과가 같으니, 대칭인 두 오버로드 중 하나만 실제 계산을 하고 나머지는 그 결과를 그대로 돌려주면 된다. 둘째, `operator==`를 `= default`로 선언한 것은 [3.1](#/classes)의 멤버 초기화 리스트, [2.8 Rule of 0/3/5](#/rule-of-five)의 `=default`/`=delete`와 정확히 같은 문법이다 — 컴파일러가 멤버 하나하나(`x`, `y`)를 비교하는 코드를 대신 써 준다. 손으로 쓰면 이렇다.

```cpp
bool operator==(const Vector2& o) const { return x == o.x && y == o.y; }
```

`= default`는 이 코드를 정확히, 멤버가 늘어나도 자동으로 따라오게 생성한다 — 멤버를 하나 추가했는데 비교 함수를 안 고쳐서 생기는 버그 자체가 성립하지 않는다. `a != b`는 `operator!=`를 따로 쓰지 않았는데도 통과했다 — C++20부터는 `operator==`가 있으면 `a != b`를 `!(a == b)`로 자동으로 다시 써서 검사한다. `!=`를 손으로 또 쓰는 관용구는 이제 구식이다.

## 삼중 비교 연산자 <=>: 여섯 개를 하나로

`Vector2`는 순서가 없는 값이라 `<`가 말이 안 되지만, 배터리 샘플처럼 "이전 값보다 큰가"를 물어야 하는 타입은 다르다. C++20 이전에는 `<`, `>`, `<=`, `>=`, `==`, `!=` 여섯 개를 전부 손으로 썼다.

```cpp title="06_old_six.cpp — C++20 이전 방식: 여섯 개를 전부 손으로 쓴다"
struct BatteryReading {
    double percent;
    int sample_id;

    bool operator==(const BatteryReading& o) const {
        return percent == o.percent && sample_id == o.sample_id;
    }
    bool operator!=(const BatteryReading& o) const { return !(*this == o); }
    bool operator<(const BatteryReading& o) const {
        if (percent != o.percent) return percent < o.percent;
        return sample_id < o.sample_id;
    }
    bool operator>(const BatteryReading& o) const  { return o < *this; }
    bool operator<=(const BatteryReading& o) const { return !(o < *this); }
    bool operator>=(const BatteryReading& o) const { return !(*this < o); }
};
```

여섯 함수가 서로 어긋나면(예를 들어 `operator<`만 고치고 `operator<=`를 안 고치면) 논리적으로 모순인 비교 결과가 나온다 — 컴파일러는 이 여섯 개가 서로 일관돼야 한다는 규칙을 검사해 주지 않는다. C++20의 삼중 비교 연산자 `<=>`(스페이스십 연산자)는 이 여섯 개를 **하나의 선언**으로 대체한다.

```cpp title="05_spaceship.cpp — <=> 하나가 여섯 개를 전부 만든다"
#include <cstdio>
#include <compare>

struct BatteryReading {
    double percent;
    int sample_id;

    auto operator<=>(const BatteryReading&) const = default;   // <, >, <=, >= 전부 여기서 나온다
};

int main() {
    BatteryReading a{42.0, 1};
    BatteryReading b{55.0, 1};

    std::printf("a <  b : %s\n", (a <  b) ? "true" : "false");
    std::printf("a >  b : %s\n", (a >  b) ? "true" : "false");
    std::printf("a <= b : %s\n", (a <= b) ? "true" : "false");
    std::printf("a >= b : %s\n", (a >= b) ? "true" : "false");
    std::printf("a == b : %s\n", (a == b) ? "true" : "false");   // == 도 <=> 로부터 자동 생성
    std::printf("a != b : %s\n", (a != b) ? "true" : "false");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 05_spaceship.cpp -o 05_spaceship
$ ./05_spaceship
a <  b : true
a >  b : false
a <= b : true
a >= b : false
a == b : false
a != b : true
```

여섯 개 비교 전부가 실제로 동작한다 — 코드에는 `<=>` 선언 딱 한 줄뿐이다. `= default`가 붙은 `operator<=>`는 [3.1](#/classes)의 초기화 순서와 같은 규칙(선언 순서)을 따라 멤버를 앞에서부터 사전식으로 비교한다 — `percent`가 먼저 비교되고, 같으면 `sample_id`로 넘어간다. 컴파일러는 이 하나의 함수로부터 `<`, `>`, `<=`, `>=`를 **다시 써서(rewrite)** 만들어 낸다 — `a < b`는 실제로 `(a <=> b) < 0`으로, `a >= b`는 `(a <=> b) >= 0`으로 컴파일러가 내부적으로 번역한다. 그리고 `==`도 여기서 함께 나온다 — `<=>`가 `=default`로 선언되면 `operator==`도 암묵적으로 함께 정의된다.

::: note `<=>`가 항상 이겨야 하는 건 아니다
`Vector2`처럼 애초에 전체 순서(total order)가 없는 타입에는 `<=>`를 붙이지 않는다. `==`/`!=`만 필요하면 앞 절처럼 `operator==`만 `=default`로 쓰는 쪽이 "이 타입에 순서가 있다"는 잘못된 신호를 안 준다. `<=>`는 "이 값들 사이에 크다/작다가 실제로 말이 되는가"라는 질문에 그렇다고 답할 수 있는 타입에만 쓴다.
:::

## operator<<로 출력하기: 반드시 자유 함수여야 하는 이유

`std::cout << a`처럼 사용자 타입을 스트림에 흘려보내려면 `operator<<`를 정의해야 한다. 그런데 이 연산자는 앞서 본 "왼쪽 피연산자가 변환 가능해야 하는" 문제와는 조금 다른, 더 확실한 이유로 자유 함수여야 한다.

```cpp title="07_ostream.cpp — operator<<는 자유 함수다"
#include <iostream>

struct Vector2 {
    double x, y;
};

// 반드시 자유 함수다 -- 왼쪽 피연산자가 std::ostream이라 Vector2의 멤버가 될 수 없다
std::ostream& operator<<(std::ostream& os, const Vector2& v) {
    return os << "(" << v.x << ", " << v.y << ")";
}

int main() {
    Vector2 a{1.5, -2.25};
    std::cout << "a = " << a << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 07_ostream.cpp -o 07_ostream
$ ./07_ostream
a = (1.5, -2.25)
```

`os << "a = " << a << "\n"`은 왼쪽부터 순서대로 묶인다 — `((os << "a = ") << a) << "\n"`. `os << a` 부분만 떼어 보면 왼쪽 피연산자는 언제나 `std::ostream`(또는 그 파생 타입)이다. **`Vector2`의 멤버 함수는 절대 이 자리에 올 수 없다** — 앞서 본 `a.operator+(b)`처럼, 멤버 함수는 왼쪽 피연산자에 매인다. `Vector2::operator<<`를 멤버로 선언하면 그 함수는 `a << os`라는 표현식만 받을 수 있다. 실제로 시도해 보면 이렇게 된다.

```cpp title="08_ostream_member_fail.cpp — 멤버로 쓰면 애초에 후보가 안 된다"
#include <iostream>

struct Vector2 {
    double x, y;

    // 멤버로 쓰면 왼쪽 피연산자가 항상 Vector2 자신이어야 한다 -- os << v 형태를 못 받는다
    std::ostream& operator<<(std::ostream& os) const {
        return os << "(" << x << ", " << y << ")";
    }
};

int main() {
    Vector2 a{1.5, -2.25};
    std::cout << "a = " << a << "\n";   // 왼쪽이 std::cout(ostream)이라 이 멤버는 후보가 안 된다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c 08_ostream_member_fail.cpp
08_ostream_member_fail.cpp: In function 'int main()':
08_ostream_member_fail.cpp:14:25: error: no match for 'operator<<' (operand types are 'std::basic_ostream<char>' and 'Vector2')
   14 |     std::cout << "a = " << a << "\n";   // 왼쪽이 std::cout(ostream)이라 이 멤버는 후보가 안 된다
      |     ~~~~~~~~~~~~~~~~~~~ ^~ ~
      |               |            |
      |               |            Vector2
      |               std::basic_ostream<char>
```

"`operand types are 'std::basic_ostream<char>' and 'Vector2'`" — 컴파일러는 `std::basic_ostream<char>::operator<<` 오버로드 목록을 뒤졌지 `Vector2`의 멤버는 애초에 검토 대상도 아니었다.

`x`, `y`가 `private`이면 자유 함수 `operator<<`는 그 멤버에 손이 닿지 않는다 — 이때가 §2에서 짚은 `friend`의 정당한 자리다.

```cpp title="11_friend.cpp — friend는 이 함수 하나에만 private 접근을 연다"
#include <iostream>

class Vector2 {
public:
    Vector2(double xi, double yi) : x_(xi), y_(yi) {}

    // friend는 이 함수 하나에만 private 접근을 열어준다 -- 클래스 전체를 열지 않는다
    friend std::ostream& operator<<(std::ostream& os, const Vector2& v);

private:
    double x_, y_;
};

std::ostream& operator<<(std::ostream& os, const Vector2& v) {
    return os << "(" << v.x_ << ", " << v.y_ << ")";   // private 멤버에 직접 접근
}

int main() {
    Vector2 a(1.5, -2.25);
    std::cout << "a = " << a << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 11_friend.cpp -o 11_friend
$ ./11_friend
a = (1.5, -2.25)
```

`friend` 선언은 클래스 안에 있지만 `operator<<` 자신은 여전히 자유 함수다 — `friend`는 멤버 자격을 주는 게 아니라 딱 이 함수 하나에 private 접근권만 준다. 이 선언을 지우면 `v.x_`, `v.y_`에서 "`private within this context`" 에러가 난다.

## 언제 참고 언제 참아야 하는가

이 책의 원칙은 하나다. **연산자 기호가 그 타입에 대해 수학적으로 이미 자연스러운 뜻을 가질 때만 오버로딩한다.** `Vector2`의 `+`, `-`, `*`, `==`, `<<`는 전부 여기 해당한다 — 벡터 덧셈, 스칼라곱, 값 비교, 출력은 이 기호들이 원래 하던 일 그대로다. 이 원칙을 넘어서면 코드가 "이 연산자가 실제로 뭘 하는지" 매번 정의를 찾아봐야 하는 상태가 된다 — C++ 커뮤니티가 부르는 이름 그대로 **놀람 최소화 원칙(principle of least astonishment)**의 위반이다.

이 책이 금지를 권하는 자리는 명확하다.

- **`operator&&`, `operator||`**: 내장 버전은 단락 평가([1.5](#/control-flow)의 그 규칙)를 한다. 사용자 정의 오버로드는 함수 호출이라 **양쪽 인자를 항상 평가한다** — 겉보기엔 같은 기호인데 의미가 다르다. `if (isValid(p) && p->update())`처럼 왼쪽이 거짓이면 오른쪽을 평가하지 않는다는 가정으로 짜인 코드가, 오버로드된 `&&` 밑에서는 조용히 널 역참조로 터진다.
- **`operator,`(콤마 연산자)**: 내장 콤마는 왼쪽을 버리고 오른쪽 값만 남긴다. 오버로드하면 `for (int i = 0, j = 10; ...)`처럼 언어 전역에 깔린 콤마의 의미와 충돌할 여지가 생긴다 — 얻는 것보다 위험이 크다.
- **단항 `operator&`**: "이 객체의 주소를 달라"는 요청을 가로채는 것은 [2.2](#/pointers)의 `&` 기본 규칙을 그 타입에서만 깨는 것과 같다. `std::addressof`가 존재하는 이유가 이 최악의 경우("`&`가 오버로드돼서 진짜 주소를 못 얻는 상황")를 우회하기 위해서다.

**예외적으로 실전에서 자주 쓰이고, 이 책도 권장하는 자리가 `operator[]`다.** 헥사포드 6개 다리의 IK 결과를 담는 간단한 고정 크기 컨테이너로 확인한다.

```cpp title="09_subscript.cpp — const/비const 버전을 나란히 오버로드한다"
#include <cstdio>
#include <stdexcept>

// 헥사포드 다리 6개의 IK 결과를 담는 간단한 고정 크기 컨테이너
class LegArray {
public:
    double& operator[](std::size_t i) {                     // 비 const 버전 -- 수정 가능
        if (i >= 6) throw std::out_of_range("LegArray: index out of range");
        return data_[i];
    }
    double operator[](std::size_t i) const {                 // const 버전 -- 읽기만
        if (i >= 6) throw std::out_of_range("LegArray: index out of range");
        return data_[i];
    }

private:
    double data_[6] = {};
};

void print_all(const LegArray& legs) {   // const 참조로 받으므로 const operator[]만 호출 가능
    for (std::size_t i = 0; i < 6; ++i) {
        std::printf("leg[%zu] = %.2f\n", i, legs[i]);
    }
}

int main() {
    LegArray legs;
    legs[0] = 1.57;    // 비 const operator[] -- 대입 가능
    legs[3] = -0.78;

    print_all(legs);

    try {
        legs[10] = 0.0;   // 범위 밖 -- 예외
    } catch (const std::out_of_range& e) {
        std::printf("잡음: %s\n", e.what());
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 09_subscript.cpp -o 09_subscript
$ ./09_subscript
leg[0] = 1.57
leg[1] = 0.00
leg[2] = 0.00
leg[3] = -0.78
leg[4] = 0.00
leg[5] = 0.00
잡음: LegArray: index out of range
```

`operator[]`는 반드시 멤버 함수다(§2에서 짚은 언어 규칙). 그리고 [3.1](#/classes)의 `const` 멤버 함수 규칙이 여기서 실전으로 쓰인다 — `double&`를 반환하는 비-const 버전은 `legs[0] = 1.57;`처럼 대입할 수 있는 자리를 내주고, `double`(값)을 반환하는 const 버전은 `const LegArray&`를 받는 `print_all` 같은 함수에서 안전하게 읽기만 허용한다. 두 버전을 둘 다 쓰지 않고 비-const 버전 하나만 두면, `print_all`처럼 `const&`로 받는 함수에서는 아예 `operator[]`를 호출할 수조차 없다 — [3.1](#/classes)에서 확인한 "const 객체는 const 멤버 함수만 부를 수 있다"는 규칙 그대로다.

## 로봇 도메인: Eigen도 결국 이 원리다

[9.1 Eigen](#/eigen)에서 실제로 쓰게 될 `Eigen::Vector3d`, `Eigen::Quaterniond`는 이 절에서 손으로 짠 `Vector2`보다 훨씬 정교하지만(표현식 템플릿으로 중간 임시 객체를 없애는 것까지 포함), 사용자가 쓰는 표면은 정확히 같은 원리 위에 있다 — `v1 + v2`, `v * scalar`, `q1 * q2`(쿼터니언 합성)가 전부 이 절에서 본 `operator+`, `operator*` 오버로딩이다.

```cpp title="10_vector3.cpp — Vector3로 확장해도 원리는 그대로다"
#include <cstdio>

struct Vector3 {
    double x, y, z;
    Vector3 operator+(const Vector3& o) const { return {x + o.x, y + o.y, z + o.z}; }
};

// 오일러 회전 같은 "합성"도 결국 operator*로 자연스럽게 표현된다 -- 여기선 스칼라곱만 확인한다
Vector3 operator*(const Vector3& v, double s) { return {v.x * s, v.y * s, v.z * s}; }

int main() {
    Vector3 gravity{0.0, 0.0, -9.81};
    Vector3 leg_force = gravity * 0.5;   // 다리 하나가 감당할 몫
    Vector3 total = gravity + leg_force;

    std::printf("leg_force = (%.2f, %.2f, %.2f)\n", leg_force.x, leg_force.y, leg_force.z);
    std::printf("total     = (%.2f, %.2f, %.2f)\n", total.x, total.y, total.z);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra 10_vector3.cpp -o 10_vector3
$ ./10_vector3
leg_force = (0.00, 0.00, -4.91)
total     = (0.00, 0.00, -14.71)
```

`Vector3`에 대해 손으로 짠 `operator+`, `operator*`가 이 정도 코드로 이미 동작한다. Eigen의 `Vector3d`도 내부는 훨씬 복잡하지만("`a + b + c`를 평가할 때 중간 벡터를 만들지 않고 최종 루프 하나로 합친다"는 표현식 템플릿 최적화가 있다), 그 위에 얹힌 `operator+`, `operator*`가 사용자에게 주는 경험은 지금 짠 `Vector3`와 동일하다 — 왜 `+`가 저렇게 동작하는지 궁금해질 그 순간, 지금 이 절이 답이 된다. 쿼터니언 합성(`q1 * q2`)이 스칼라곱과 다른 연산인데도 같은 `operator*` 기호를 쓰는 이유도 같다 — "곱셈"이라는 수학적 의미가 유지되는 한 기호를 재사용해도 놀랍지 않다는 것이 이 절 §6의 기준 그대로 적용된 사례다.

## 요약

- `add(a, b)`와 `a + b`는 같은 계산이지만, 후자는 독자가 이미 아는 산술 표기를 그대로 쓴다 — 연산자 오버로딩의 정당한 이유는 "이 타입이 그 연산을 수학적으로 이미 갖고 있는가"다.
- **멤버 함수는 왼쪽 피연산자에 매인다** — `5.0 + a`처럼 왼쪽에 암묵 변환이 필요한 대칭 연산은 자유 함수여야 한다(실측: 멤버 버전은 `no match for 'operator+'`).
- `operator=`, `operator[]`, `operator()`, `operator->`는 언어가 멤버 함수를 강제한다. `operator<<`는 왼쪽 피연산자가 항상 `std::ostream`이라 **아예 멤버가 될 수 없다**(실측: 멤버로 쓰면 `os << a` 형태 자체가 후보에서 빠진다).
- `operator==`를 `=default`로 선언하면 [2.6](#/copy-semantics)에서 본 멤버별 비교를 컴파일러가 대신 써 준다. C++20부터는 `operator==`만 있어도 `!=`가 그로부터 자동으로 다시 쓰인다.
- **삼중 비교 연산자 `<=>`**를 `=default`로 선언하면 `<`, `>`, `<=`, `>=`(그리고 `==`)가 전부 자동 생성된다(실측: 여섯 비교 전부 동작). 이전 방식은 여섯 함수를 손으로 써야 했고 서로 어긋날 위험이 있었다.
- `operator&&`, `operator,`, 단항 `operator&`는 내장 버전의 핵심 의미(단락 평가, 콤마의 값 버림, 진짜 주소 반환)를 조용히 깨뜨리므로 오버로드를 피한다. `operator[]`는 실전에서 안전하게 쓰는 예외다 — const/비const 버전을 나란히 오버로드해 `const&`로 받는 함수에서도 읽기가 가능하게 한다.
- Eigen의 `Vector3d`, `Quaterniond` 연산자는 이 절에서 짠 `Vector2`, `Vector3`와 원리가 같다 — 사용자가 보는 `+`, `*`는 결국 이 절의 `operator+`, `operator*`다.

::: interview 연산자 오버로딩을 멤버로 할지 자유 함수로 할지 어떻게 정하나
자주 나오는 설계 질문이다. 답변 뼈대: ① **왼쪽 피연산자에 암묵 변환이 필요한지가 결정한다** — 멤버 함수는 호출 문법상 왼쪽 피연산자에 매여 있어 그 자리에 변환이 걸리지 않는다(`5.0 + a`가 멤버 버전에서 컴파일 안 되는 이유). 대칭이어야 하는 이항 연산자(`+`, `-`, `==`)는 자유 함수로 쓴다. ② **언어가 강제하는 예외**가 있다 — `operator=`, `operator[]`, `operator()`, `operator->`는 표준이 멤버 함수여야 한다고 규정한다. ③ **`operator<<`는 왼쪽 피연산자가 항상 `std::ostream`이므로 아예 멤버로 만들 수조차 없다** — 이 경우는 선택의 여지가 없다. ④ private 멤버 접근이 필요하면 `friend`를 쓰되, 클래스에 이미 필요한 접근자가 있으면 `friend` 없이 그 접근자만으로 짜는 쪽이 캡슐화를 덜 허문다는 것까지 말하면 좋은 답이다.
:::

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습(코드 작성형)이다.

1. `operator+`를 멤버 함수로 선언했을 때 `5.0 + a`가 컴파일되지 않는 이유를 "왼쪽 피연산자"라는 표현을 써서 한 문장으로 설명하라. `operator<<`가 이 문제와 별개로 애초에 멤버가 될 수 없는 이유는 무엇인가?
2. `operator&&`를 사용자 타입에 오버로드하면 안 되는 이유를 단락 평가 관점에서 설명하라. `if (isValid(p) && p->update())` 같은 코드가 왜 위험해지는가?
3. 다음 클래스에 `<=>`를 `=default`로 추가하면 `a < b`, `a >= b`가 각각 어떤 순서로 판단되는지 예측하라. 어떤 규칙(멤버 나열 순서? 선언 순서?)을 근거로 대는가?

   ```cpp
   struct JointLimit {
       double min_rad;
       double max_rad;
       auto operator<=>(const JointLimit&) const = default;
   };
   ```

4. (실습) `Vector2`에 `operator==`뿐 아니라 `auto operator<=>(const Vector2&) const = default;`를 추가해서 컴파일해 보라. `<`, `>`, `<=`, `>=`가 실제로 동작하는지 각각 `printf`로 확인하고, `Vector2`에 순서를 매기는 게 의미가 있는 타입인지 스스로 판단해 주석으로 남겨라. 성공 기준: 네 개 비교 연산자가 전부 경고 없이 컴파일되고 예상한 참/거짓이 나온다.
5. (실습) `Vector2`에 대해 `std::ostream& operator<<(std::ostream&, const Vector2&)`를 자유 함수로 직접 구현하라. `x`, `y`가 `private`이 되도록 클래스를 고치고, `operator<<`가 그 멤버에 접근할 수 있도록 `friend` 선언을 추가하라. 성공 기준: `std::cout << v;`가 `(x, y)` 형식으로 출력되고, `friend` 선언을 지우면 컴파일이 깨지는 것까지 직접 확인했다.
:::

::: answer 해설
1. 멤버 함수 호출 `a.operator+(b)`는 왼쪽 피연산자(`a`)에 매인 함수를 찾는 것과 같다 — `5.0 + a`를 이 형태로 옮기면 `5.0.operator+(a)`가 되는데 `double`에는 멤버 함수가 없으니 오버로드 후보 자체가 성립하지 않는다. `operator<<`는 이것과 별개로, 왼쪽 피연산자가 이 클래스가 아니라 항상 `std::ostream`이라서 `Vector2::operator<<`로 선언해도 `os << v` 형태의 호출에는 애초에 후보가 될 수 없다 — 멤버로 쓰면 `v << os`만 받을 수 있다.
2. 내장 `&&`는 왼쪽이 거짓이면 오른쪽을 평가하지 않는다(단락 평가). 사용자 정의 `operator&&`는 보통의 함수 호출이라 C++이 함수 호출 규칙(모든 인자를 먼저 평가)을 그대로 적용한다 — 오버로드된 `&&`는 왼쪽·오른쪽을 항상 둘 다 평가한다. `if (isValid(p) && p->update())`는 `isValid(p)`가 거짓이면 `p->update()`가 실행 안 된다는 가정으로 짜였는데, 오버로드된 `&&` 밑에서는 `p`가 무효여도 `p->update()`가 실행돼 널 역참조로 이어질 수 있다.
3. 멤버 선언 순서(`min_rad`가 `max_rad`보다 먼저 선언됨)를 따라 사전식으로 비교한다. `a < b`는 `min_rad`를 먼저 비교하고, 같으면 `max_rad`로 넘어가서 결과를 낸다. `a >= b`도 같은 순서로 비교하되 부등호 방향만 반대다. 근거는 [3.1](#/classes) 멤버 초기화 리스트에서 이미 확인한 규칙과 같다 — `=default`로 생성되는 코드는 표기 순서가 아니라 항상 멤버의 **선언 순서**를 따른다.
4. `auto operator<=>(const Vector2&) const = default;`를 추가하면 `a < b`, `a > b`, `a <= b`, `a >= b`가 전부 `x`를 먼저, 같으면 `y`를 비교하는 사전식 순서로 동작한다 — 이 절의 `05_spaceship.cpp`와 같은 구조다. 다만 `Vector2`는 평면 위의 점이라 "크다/작다"가 물리적으로 의미가 없는 값이다 — 컴파일은 되지만 실제로 쓰기엔 적절하지 않은 사례로 남겨 두는 것이 정확한 판단이다.
5. `friend std::ostream& operator<<(std::ostream&, const Vector2&);`를 클래스 안에 선언하고, 클래스 밖에서 그 함수를 정의해 `os << "(" << v.x_ << ", " << v.y_ << ")"`처럼 private 멤버(`x_`, `y_`)에 직접 접근하면 된다 — 이 절의 `11_friend.cpp`와 같은 구조다. `friend` 선언을 지우면 `x_`, `y_`가 private이라 클래스 밖 함수에서 접근할 수 없다는 에러(`'double Vector2::x_' is private within this context`류)가 난다 — [3.1](#/classes)에서 본 `private` 접근 에러와 같은 종류다.
:::

이 절의 연산자는 전부 직접 타이핑해라. 특히 `02_member_asymmetry.cpp`는 멤버 버전으로 먼저 실패를 직접 보고, 그다음 `03_free_symmetry.cpp`로 고쳐서 같은 계산이 통과하는 과정을 눈으로 따라가라. `<=>`는 `05_spaceship.cpp`를 타이핑한 뒤 멤버 순서를 바꿔 가며(`sample_id`를 `percent`보다 먼저 선언) 비교 결과가 달라지는지 직접 확인해 봐라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`.

**다음 절**: [3.7 컴포지션 vs 상속](#/composition) — 이 절까지 다형성(가상함수, 추상 인터페이스)과 값 타입 연산자를 다뤘다. 다음 절은 "이 관계를 상속으로 표현할까, 멤버로 담을까"라는 훨씬 자주 마주치는 설계 질문을 결합도의 관점에서 정리한다 — `Vector2`처럼 값이 분명한 타입은 상속 후보조차 안 된다는 것부터 시작한다.
