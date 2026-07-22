# 3.1 클래스: 캡슐화와 불변식

::: lead
[1.8](#/structs-enums)에서 구조체로 "관절 하나의 상태"라는 의미 단위를 묶었다. 그런데 구조체의 멤버는 전부 public이다 — 묶긴 묶었는데, 묶인 값 사이의 **관계**는 아무도 지키지 않는다. 배터리 잔량은 0~100 사이여야 한다는 것, 관절 최소각은 최대각보다 작아야 한다는 것 — 이런 조건을 표준은 "불변식(invariant)"이라 부르고, 이 절은 그 조건을 타입 스스로 지키게 만드는 도구를 다룬다. class와 struct의 차이는 딱 한 글자 수준의 규칙뿐이지만, 그 한 글자가 여는 것은 "값을 마음대로 못 바꾸는 타입"이라는 완전히 다른 설계 축이다. 멤버 초기화 리스트, 생성자 검증, const 멤버 함수까지 — 전부 이 축 위에 있다.
:::

## 아무나 넣을 수 있는 값은 배터리 잔량이 아니다

문제부터 본다. 헥사포드의 배터리 상태를 [1.8](#/structs-enums) 방식 그대로 구조체로 표현하면 이렇다.

```cpp title="battery_struct.cpp — 0~100이어야 한다는 것을 아무도 지키지 않는다"
#include <cstdio>

struct BatteryStatus {
    double percent;    // 0~100 이어야 한다는 것은 아무도 강제하지 않는다
    bool charging;
};

int main() {
    BatteryStatus b{50.0, false};
    b.percent = -50.0;      // 컴파일도 되고 실행도 된다
    b.percent = 9999.0;     // 이것도
    std::printf("percent = %g\n", b.percent);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra battery_struct.cpp -o battery_struct
$ ./battery_struct
percent = 9999
```

경고 한 줄 없이 컴파일되고, 실행도 끝까지 간다. `percent`는 `double` 하나일 뿐이라 컴파일러 눈에는 `-50.0`도 `9999.0`도 똑같이 유효한 값이다. 이 값은 로봇 소프트웨어의 다른 부분으로 그대로 흘러간다 — "잔량이 20% 밑이면 임무를 중단한다"는 안전 로직이 `percent = 9999.0`을 만나면 그 조건은 영원히 거짓이 되고, `percent = -50.0`을 만나면 항상 참이 될 수도 있다. 구조체 자체는 잘못한 게 없다. **"0 이상 100 이하"라는 조건을 표현할 자리가 애초에 이 타입에 없었을 뿐이다.**

이 조건 — 타입이 살아 있는 동안 항상 성립해야 하는 값들 사이의 관계 — 을 **클래스 불변식(class invariant)**이라 부른다. `BatteryStatus`의 불변식은 "`0.0 <= percent <= 100.0`"이고, 앞으로 볼 `JointLimit`의 불변식은 "`min_ < max_`"다. 구조체는 불변식을 표현하는 문법을 갖고 있지 않다 — 멤버가 전부 public이면 누구든 멤버 하나만 바꿔서 불변식을 깰 수 있다. 이 절이 다루는 것은 그 문법, 즉 class다.

## class와 struct는 접근 지정자 하나만 다르다

`class`와 `struct`가 서로 다른 언어 기능이라고 생각하기 쉽지만, 표준이 정한 차이는 딱 하나다 — **명시하지 않은 멤버의 기본 접근 지정자**. `class`는 기본이 `private`, `struct`는 기본이 `public`이다. 그게 전부다. 실측으로 확인한다.

```cpp title="access_default.cpp — 같은 멤버, 다른 기본 접근 지정자"
class Coord { double x; double y; };   // 기본은 private
struct Vec2 { double x; double y; };   // 기본은 public

int main() {
    Coord c;
    Vec2  v;
    c.x = 3.0;           // private 멤버에 바깥에서 접근
    v.x = 3.0;           // public 멤버에 바깥에서 접근
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c access_default.cpp
access_default.cpp: In function 'int main()':
access_default.cpp:7:7: error: 'double Coord::x' is private within this context
    7 |     c.x = 3.0;           // private 멤버에 바깥에서 접근
      |       ^
access_default.cpp:1:22: note: declared private here
    1 | class Coord { double x; double y; };   // 기본은 private
      |                      ^
```

`Coord::x`에 접근한 줄만 에러가 났다 — `Vec2::x`는 아무 문제 없다. 멤버 선언도 똑같고 접근하는 코드도 똑같은데, 클래스 정의에 쓴 키워드 하나로 컴파일 결과가 갈린다. 상속의 기본 접근 지정자(`class`는 private 상속, `struct`는 public 상속 — [3.3](#/inheritance)에서 다룬다)도 같은 규칙의 연장선이다. 문법적으로는 `class`에 멤버를 전부 `public:` 아래 몰아넣으면 `struct`와 완전히 동일하게 동작하고, 그 반대도 마찬가지다.

그렇다면 언제 무엇을 쓰는가. 이 책의 관례는 [1.8](#/structs-enums)에서 이미 예고했다 — **불변식이 있으면 class, 순수한 데이터 묶음이면 struct.** `JointState{position, velocity, effort}`처럼 세 값이 서로 독립적이고 어떤 조합도 유효하면 struct로 남긴다. "이 값의 범위는 여기까지"라는 조건이 생기는 순간 class로 옮기고, 그 조건을 지킬 책임을 타입 자신에게 지운다. 다음 절부터는 이 관례를 아무 설명 없이 그대로 쓴다.

## 캡슐화는 숨기는 게 아니라 지키는 것이다

`private`를 처음 배울 때 흔히 듣는 말이 "정보 은닉"이다. 틀린 말은 아니지만 방향이 어긋나 있다 — 정보 은닉 자체가 목적이면 "그래서 뭐가 좋은가"에 답이 궁해진다. 이 책이 쓰는 관점은 다르다. **`private`는 "이 값을 함부로 바꾸지 못하게" 만드는 도구가 아니라, "이 값을 바꾸는 통로를 하나로 좁히는" 도구다.** 통로가 하나면 그 통로에 검사를 심을 수 있고, 그래야 불변식을 지킬 수 있다. 감추는 것은 수단이지 목적이 아니다.

`BatteryStatus`를 이 관점으로 다시 설계한다.

```cpp title="battery_private.cpp — 멤버를 감췄지만, 아직 검사는 없다"
class BatteryStatus {
public:
    double percent() const { return percent_; }
    void set_percent(double p) { percent_ = p; }   // 아직 아무 검사도 없다

private:
    double percent_ = 0.0;
};
```

이 시점에서 `b.percent_ = 9999.0;`은 외부에서 더 이상 못 쓴다(`private`이므로 컴파일 에러). 그런데 `b.set_percent(9999.0);`은 여전히 통과한다 — `set_percent`가 검사 없이 대입만 하기 때문이다. **`private`만으로는 불변식이 지켜지지 않는다.** `private`가 하는 일은 "값을 바꾸는 길을 `set_percent` 하나로 좁힌다"는 것뿐이고, 불변식을 실제로 지키는 것은 그 길 위에 놓인 검사 코드다 — 다음 절에서 그 검사를 채운다. 이 좁힘의 효과는 분명하다: 검사를 딱 한 곳에만 심으면 되고, 멤버가 18개짜리 배열(헥사포드 관절 수)로 늘어나도 검사 지점의 개수는 여전히 하나다.

## 멤버 초기화 리스트: 대입이 아니라 생성이다

생성자 본문에서 멤버에 값을 넣는 것과, 콜론 뒤 초기화 리스트에서 넣는 것은 최종 결과가 같아 보여도 같은 연산이 아니다. **본문의 `=`는 대입이고, 초기화 리스트는 생성 그 자체다.** 이미 만들어진 멤버에 나중에 값을 끼얹는 것과, 멤버를 만드는 순간 그 값으로 만드는 것의 차이다. 이 차이가 선택이 아니라 강제가 되는 멤버가 둘 있다 — `const` 멤버와 레퍼런스 멤버다.

```cpp title="member_init_required.cpp — const·레퍼런스 멤버는 본문 대입이 안 된다"
class JointLimit {
public:
    JointLimit(double lo, double hi, const double& ref) {
        min_ = lo;    // const 멤버 -- 본문 대입 불가
        max_ = hi;
        ref_ = ref;   // 레퍼런스 멤버 -- 본문 대입 불가 (재바인딩 자체가 없다)
    }

private:
    const double min_;
    const double max_;
    const double& ref_;
};
```

```console
$ g++ -std=c++20 -Wall -Wextra -c member_init_required.cpp
member_init_required.cpp: In constructor 'JointLimit::JointLimit(double, double, const double&)':
member_init_required.cpp:3:5: error: uninitialized const member in 'const double' [-fpermissive]
member_init_required.cpp:10:18: note: 'const double JointLimit::min_' should be initialized
member_init_required.cpp:3:5: error: uninitialized reference member in 'const double&' [-fpermissive]
member_init_required.cpp:12:19: note: 'const double& JointLimit::ref_' should be initialized
member_init_required.cpp:4:14: error: assignment of read-only member 'JointLimit::min_'
member_init_required.cpp:6:14: error: assignment of read-only member 'JointLimit::ref_'
```

컴파일러가 두 종류의 에러를 함께 낸다. "`uninitialized const member`" — 초기화가 끝나야 할 시점에 이 멤버가 아직 초기화되지 않았다는 뜻이다. "`assignment of read-only member`" — 본문의 `min_ = lo;`는 초기화가 아니라 이미 만들어진 `const` 객체에 대한 **대입**으로 취급되고, `const`는 대입을 허용하지 않는다. 레퍼런스 멤버도 같은 이유로 걸린다 — 레퍼런스는 [2.3](#/references)에서 배운 대로 재바인딩이 없는 타입이라 "일단 만들고 나중에 다시 묶는" 시나리오 자체가 성립하지 않는다. 고치면 이렇다.

```cpp title="member_init_fixed.cpp — 초기화 리스트로 고쳤다"
#include <cstdio>

class JointLimit {
public:
    JointLimit(double lo, double hi, const double& ref)
        : min_(lo), max_(hi), ref_(ref) {}   // 본문 대입이 아니라 생성 그 자체

    double min() const { return min_; }
    double max() const { return max_; }

private:
    const double min_;
    const double max_;
    const double& ref_;
};

int main() {
    double zero = 0.0;
    JointLimit jl(-1.57, 1.57, zero);
    std::printf("min = %g, max = %g\n", jl.min(), jl.max());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra member_init_fixed.cpp -o member_init_fixed
$ ./member_init_fixed
min = -1.57, max = 1.57
```

일반 멤버(`double`, `int` 등)라면 본문 대입도 문법적으로는 통과한다. 그런데도 이 책은 **`double`·`int` 멤버조차 항상 초기화 리스트로 쓴다**를 관례로 삼는다. 이유는 순서에 있다.

### 초기화 순서는 리스트가 아니라 선언 순서를 따른다

[1.8](#/structs-enums)에서 "C++ 멤버는 선언 순서대로 생성되고 역순으로 소멸된다"는 보장을 짚었다. 리스트를 어떤 순서로 쓰든 실제 실행은 그 보장을 따른다 — 표기 순서는 실행 순서에 아무 영향이 없다. [2.8](#/rule-of-five)의 `Tattle`과 같은 장치로 생성 시점을 직접 증언하게 만들어 확인한다.

```cpp title="init_order.cpp — 리스트는 percent_, charging_ 순서로 썼다"
#include <cstdio>

// 생성 시점을 표준 출력으로 증언하는 멤버
struct Announce {
    explicit Announce(const char* name) { std::printf("  %s 초기화\n", name); }
};

class BatteryStatus {
public:
    // 리스트에는 charging_보다 percent_를 먼저 썼다
    BatteryStatus() : percent_("percent_"), charging_("charging_") {}

private:
    Announce charging_;   // 선언 순서: charging_가 percent_보다 먼저다
    Announce percent_;
};

int main() {
    std::printf("BatteryStatus 생성 시작\n");
    BatteryStatus b;
    (void)b;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra init_order.cpp -o init_order
init_order.cpp: In constructor 'BatteryStatus::BatteryStatus()':
init_order.cpp:15:14: warning: 'BatteryStatus::percent_' will be initialized after [-Wreorder]
init_order.cpp:14:14: warning:   'Announce BatteryStatus::charging_' [-Wreorder]
init_order.cpp:11:5: warning:   when initialized here [-Wreorder]
$ ./init_order
BatteryStatus 생성 시작
  charging_ 초기화
  percent_ 초기화
```

리스트는 `percent_("percent_"), charging_("charging_")` 순서로 썼는데, 실제 출력은 `charging_` 먼저다 — 선언 순서(`charging_`가 `percent_`보다 먼저 선언됨)를 그대로 따랐다. `-Wall`에 포함된 `-Wreorder` 경고가 이 불일치를 바로 잡아 준다. 이 경고를 무시하면 안 되는 이유는 명확하다 — 만약 `percent_`의 초기화식이 `charging_`의 값을 참조하는 코드였다면, 리스트 표기만 믿는 순간 초기화되지 않은 멤버를 읽는 버그가 생긴다. **초기화 리스트는 항상 선언 순서와 똑같이 쓴다.**

## 불변식을 코드로 강제하기

이제 값을 좁히는 통로(생성자, 세터)에 실제 검사를 채울 차례다. 두 가지 방법이 있고, 선택은 "이 검사가 실패했을 때 프로그램이 계속 살아 있어야 하는가"에 달렸다.

**`assert`는 개발 중의 안전망이지, 배포 코드의 방어선이 아니다.** `<cassert>`의 `assert`는 조건이 거짓이면 그 자리에서 `abort()`를 부른다 — 그리고 매크로 `NDEBUG`가 정의되면 **통째로 사라진다.**

```cpp title="assert_ndebug.cpp — NDEBUG가 정의되면 검사 자체가 없어진다"
#include <cassert>
#include <cstdio>

class BatteryStatus {
public:
    explicit BatteryStatus(double p) : percent_(p) {
        assert(p >= 0.0 && p <= 100.0);   // 디버그 빌드에서만 걸린다
    }
    double percent() const { return percent_; }

private:
    double percent_;
};

int main() {
    BatteryStatus b(9999.0);   // 불변식을 명백히 어겼다
    std::printf("percent = %g\n", b.percent());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra assert_ndebug.cpp -o assert_ndebug
$ ./assert_ndebug
assert_ndebug: assert_ndebug.cpp:7: BatteryStatus::BatteryStatus(double): Assertion `p >= 0.0 && p <= 100.0' failed.
Aborted (core dumped)

$ g++ -std=c++20 -Wall -Wextra -DNDEBUG assert_ndebug.cpp -o assert_ndebug_rel
$ ./assert_ndebug_rel
percent = 9999
```

같은 소스, 플래그 하나(`-DNDEBUG`) 차이로 결과가 정반대다 — 앞은 즉시 중단(`Aborted`), 뒤는 `9999`를 그대로 들고 조용히 실행된다. 우연이 아니다. CMake의 `Release` 빌드 타입은 관례적으로 `NDEBUG`를 자동 정의한다 — **개발 중 잡히던 버그가 배포 빌드에서는 조용히 통과한다는 뜻이다.** `assert`가 정당한 자리는 "호출자의 실수로 절대 일어나서는 안 되는 조건"이지, "외부에서 온 값이 유효한지"처럼 실행 중 실제로 벌어질 수 있는 조건이 아니다. 배터리 잔량은 후자다. 이런 자리는 **예외**로 막는다.

```cpp title="battery_class.cpp — 생성자와 세터가 같은 검사를 통과시킨다"
#include <cstdio>
#include <stdexcept>

class BatteryStatus {
public:
    explicit BatteryStatus(double percent) : percent_(validate(percent)) {}

    double percent() const { return percent_; }

    void set_percent(double p) {
        percent_ = validate(p);   // 값이 바뀌는 유일한 통로도 같은 검사를 거친다
    }

private:
    static double validate(double p) {   // 정적 멤버 함수 -- 특정 객체 없이도 호출된다
        if (p < 0.0 || p > 100.0) {
            throw std::invalid_argument("BatteryStatus: percent out of range [0, 100]");
        }
        return p;
    }

    double percent_;
};

int main() {
    BatteryStatus b(50.0);
    std::printf("생성 직후 percent = %g\n", b.percent());

    try {
        b.set_percent(-50.0);   // 불변식을 어기는 시도
    } catch (const std::invalid_argument& e) {
        std::printf("잡음: %s\n", e.what());
    }
    std::printf("예외 이후에도 percent = %g (불변식 유지됨)\n", b.percent());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra battery_class.cpp -o battery_class
$ ./battery_class
생성 직후 percent = 50
잡음: BatteryStatus: percent out of range [0, 100]
예외 이후에도 percent = 50 (불변식 유지됨)
```

핵심은 검사 함수(`validate`)가 **생성자와 세터 둘 다에서** 불린다는 것이다 — 값이 이 클래스 안으로 들어오는 문은 딱 두 개고, 두 문 모두 같은 검사를 거친다. `set_percent(-50.0)`은 예외를 던지고, `catch` 블록이 잡은 뒤에도 `percent_`는 여전히 `50`이다 — 대입이 `validate`를 통과하기 **전에** 예외가 나므로 값은 아예 손대지지 않는다. 이것이 **클래스 불변식**의 정의다: **모든 public 메서드가 실행을 마친 시점(정상 반환이든, 예외로 빠져나가든)에 성립해야 하는 조건.**

::: warn private는 컴파일 타임 방어, 검사는 런타임 방어 — 하나로는 부족하다
`private`는 "`b.percent_ = 9999.0;`처럼 멤버에 직접 접근하는 코드가 컴파일조차 안 되게" 만든다. 이것은 컴파일 타임 방어다. 반면 `validate`는 "`b.set_percent(9999.0);`처럼 정당한 통로로 들어온 값이 실행 중 걸러지게" 만든다. 이것은 런타임 방어다. 이 절 도입부의 `battery_private.cpp`가 보여준 것처럼, 컴파일 타임 방어만 있고 런타임 방어가 없으면 좁힌 통로 안에서 불변식이 여전히 뚫린다. 둘 다 있어야 한다.
:::

## const 멤버 함수: this는 사실 const 포인터다

`percent()`처럼 멤버를 읽기만 하는 함수 뒤에 `const`를 붙이는 습관을 이미 여러 예제에서 봤다. 이 `const`는 장식이 아니라 컴파일러에게 하는 약속이다 — **이 함수 안에서는 멤버를 바꾸지 않는다.** 모든 멤버 함수는 숨은 첫 인자로 `this` 포인터를 받는데, `const` 멤버 함수의 `this`는 `BatteryStatus*`가 아니라 **`const BatteryStatus*`**다. `const` 포인터가 가리키는 대상을 못 바꾸는 것은 [2.2](#/pointers)에서 배운 규칙 그대로이고, 그 대상이 우연히 `this`일 뿐이다. 어기면 그 규칙 그대로 걸린다.

```cpp title="const_member_fn.cpp — const 멤버 함수 안에서 멤버를 바꾸려 했다"
class BatteryStatus {
public:
    explicit BatteryStatus(double p) : percent_(p) {}

    double percent() const {
        percent_ += 1.0;   // const 멤버 함수 안에서 멤버를 수정하려 했다
        return percent_;
    }

private:
    double percent_;
};
```

```console
$ g++ -std=c++20 -Wall -Wextra -c const_member_fn.cpp
const_member_fn.cpp: In member function 'double BatteryStatus::percent() const':
const_member_fn.cpp:6:18: error: assignment of member 'BatteryStatus::percent_' in read-only object
    6 |         percent_ += 1.0;   // const 멤버 함수 안에서 멤버를 수정하려 했다
      |         ~~~~~~~~~^~~~~~
```

"`read-only object`"라는 표현이 정확하다 — `const` 멤버 함수 안에서는 `*this` 전체가 읽기 전용 객체로 취급된다. 이 약속은 반대 방향에서도 강제된다 — `const`로 선언된 객체는 `const` 멤버 함수만 부를 수 있다.

```cpp title="const_object_call.cpp — const 객체가 non-const 메서드를 부르려 했다"
class BatteryStatus {
public:
    explicit BatteryStatus(double p) : percent_(p) {}
    void set_percent(double p) { percent_ = p; }   // const가 안 붙은 메서드
    double percent() const { return percent_; }

private:
    double percent_;
};

int main() {
    const BatteryStatus b(50.0);   // const 객체
    b.set_percent(10.0);           // const 객체에서 non-const 메서드를 호출
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c const_object_call.cpp
const_object_call.cpp: In function 'int main()':
const_object_call.cpp:13:18: error: passing 'const BatteryStatus' as 'this' argument discards qualifiers [-fpermissive]
   13 |     b.set_percent(10.0);           // const 객체에서 non-const 메서드를 호출
      |     ~~~~~~~~~~~~~^~~~~~
```

"`discards qualifiers`" — `const BatteryStatus`를 `set_percent`가 원하는 `BatteryStatus*`(`this`) 자리에 넘기려면 `const`라는 자격을 버려야 하는데, 허용되지 않는다. 이 규칙 덕분에 함수 시그니처만 보고 "이 함수가 객체를 바꾸는지"를 알 수 있다 — [1.6](#/functions)에서 매개변수에 `const&`를 붙여 의도를 드러낸 것과 같은 방식이 멤버 함수 자신에도 적용되는 셈이다. **`const` 붙일 수 있는 멤버 함수에는 전부 붙여라** — 이 객체를 `const&`로 넘겨받는 함수(로그 출력기, 비교 함수 등)가 아무 문제 없이 `percent()`를 호출할 수 있게 된다. 예외적으로 "논리적으로는 상수인데 내부적으로 캐시를 갱신해야 하는" 멤버를 위한 `mutable` 키워드는 [3.8 클래스 설계 실전](#/class-design)에서 다룬다.

## 로봇 도메인: 불변식이 안전으로 이어지는 자리

배터리 잔량과 함께 헥사포드 코드베이스에서 불변식이 안전과 직결되는 자리가 관절 각도 한계다. 다리 하나(coxa-femur-tibia)의 관절마다 물리적으로 넘어갈 수 없는 최소·최대 각도가 있고, 이 값 자체도 "최소가 최대보다 작아야 한다"는 불변식을 갖는다.

```cpp title="joint_limit.cpp — 두 겹의 불변식: 한계 자체의 유효성, 그리고 clamp의 결과"
#include <cstdio>
#include <stdexcept>

class JointLimit {
public:
    JointLimit(double min_rad, double max_rad)
        : min_(validate(min_rad, max_rad)), max_(max_rad) {}

    double clamp(double angle) const {
        if (angle < min_) return min_;
        if (angle > max_) return max_;
        return angle;
    }

private:
    static double validate(double lo, double hi) {
        if (lo >= hi) {
            throw std::invalid_argument("JointLimit: min must be less than max");
        }
        return lo;
    }

    double min_;
    double max_;
};

int main() {
    JointLimit coxa(-1.57, 1.57);   // 헥사포드 coxa 관절의 각도 한계 (라디안)
    std::printf("clamp(3.0)  = %g\n", coxa.clamp(3.0));
    std::printf("clamp(-3.0) = %g\n", coxa.clamp(-3.0));
    std::printf("clamp(0.5)  = %g\n", coxa.clamp(0.5));

    try {
        JointLimit bad(1.0, -1.0);   // min >= max -- 물리적으로 말이 안 되는 한계
        (void)bad;
    } catch (const std::invalid_argument& e) {
        std::printf("잡음: %s\n", e.what());
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra joint_limit.cpp -o joint_limit
$ ./joint_limit
clamp(3.0)  = 1.57
clamp(-3.0) = -1.57
clamp(0.5)  = 0.5
잡음: JointLimit: min must be less than max
```

[9.5 역기구학](#/inverse-kinematics)이 계산해 내는 관절 목표 각도는 순수 수학의 결과일 뿐 하드웨어의 물리적 한계를 모른다 — 그 값을 실제 모터에 넘기기 전에 `clamp`를 거치는 것은 수학과 별개의 안전 계층이다. [10.9 ros2_control과 hardware_interface](#/ros2-control)에서 이 계층이 실제로 어디에 앉는지 보게 되는데, 요지는 지금과 같다 — **한계값 자체가 잘못 설정되면(설정 파일 오타로 `min_`이 `max_`보다 커지면) 그 사실을 프로그램이 시작하는 순간 알아야지, 다리가 이상하게 꺾인 뒤에 알아서는 안 된다.** `JointLimit`의 생성자가 정확히 그 일을 한다 — 이 클래스는 잘못된 설정을 담을 수조차 없다.

::: interview 캡슐화가 뭐고 왜 중요한가
가장 흔한 답 "데이터와 함수를 묶고 외부에서 못 보게 감추는 것"은 절반만 맞다. 더 나은 답변 뼈대: ① **캡슐화의 목적은 정보 은닉 자체가 아니라 불변식 보호다** — `private`는 값을 바꾸는 통로를 좁혀서 검사를 심을 수 있게 만드는 수단이다. ② **`private`만으로는 부족하다** — 통로 안에 검사가 없으면(`set_percent`가 그냥 대입만 하면) 불변식은 여전히 깨진다. 컴파일 타임 방어(접근 제어)와 런타임 방어(값 검증)는 별개이고 둘 다 필요하다. ③ **클래스 불변식**을 정의로 대라 — "모든 public 메서드가 실행을 마친 시점에 성립해야 하는 조건". ④ 후속 질문 "그럼 struct는 왜 있나" — 불변식이 없는 순수 데이터 묶음에는 캡슐화가 불필요하고, struct로 의도를 드러내는 것이 옳다는 판단 기준까지 말하면 좋은 답이다.
:::

## 요약

- 구조체는 "관련된 데이터"를 묶지만 그 값들 사이의 관계(**클래스 불변식**)는 지키지 않는다 — 실측: `percent = 9999.0`이 경고 없이 통과한다.
- `class`와 `struct`의 표준 차이는 **기본 접근 지정자** 하나뿐이다(class는 private, struct는 public). 이 책의 관례: 불변식이 있으면 class, 순수 데이터 묶음이면 struct.
- **캡슐화의 목적은 정보 은닉이 아니라 불변식 보호다.** `private`는 값을 바꾸는 통로를 좁히는 수단이고, 그 통로 안의 검사(생성자·세터)가 실제로 불변식을 지킨다 — 검사 없는 `private`는 컴파일 타임 방어만 있고 런타임 방어가 없다(실측: `set_percent(9999.0)`이 그냥 통과).
- **멤버 초기화 리스트는 대입이 아니라 생성이다.** `const`·레퍼런스 멤버는 본문 대입이 원천적으로 안 되고(`uninitialized const/reference member` 에러 실측), 초기화 순서는 리스트 표기가 아니라 **선언 순서**를 따른다(`-Wreorder` 경고, `Announce` 실측).
- 생성자·세터의 유효성 검사는 `assert`(개발 중 안전망, `NDEBUG`로 사라짐 — 실측)가 아니라 예외(항상 살아 있음)로 한다. 값이 들어오는 모든 통로가 같은 검사 함수를 거쳐야 불변식이 유지된다.
- `const` 멤버 함수의 `this`는 `const T*`다 — 그 안에서 멤버 수정은 컴파일 에러이고(`read-only object` 실측), `const` 객체는 `const` 멤버 함수만 부를 수 있다(`discards qualifiers` 실측). 붙일 수 있으면 전부 붙여라.

::: quiz 연습문제
1번과 2번은 개념, 3번은 예측, 4번과 5번은 네 컴퓨터에서 직접 확인하는 실습(코드 작성형)이다.

1. `class`와 `struct`의 표준상 차이를 한 문장으로 말하고, 이 책이 "불변식이 있으면 class"를 관례로 삼는 이유를 설명하라.
2. "`private` 멤버로 만들었으니 이 클래스는 안전하다"는 리뷰 코멘트에 반박하라. `battery_private.cpp`의 `set_percent`를 근거로 들어라.
3. 다음 클래스에서 `charging_`과 `percent_`의 실제 초기화 순서를 예측하고, 그 근거(어떤 규칙을 따르는지)를 대라.

   ```cpp
   class BatteryStatus {
   public:
       BatteryStatus() : charging_(false), percent_(0.0) {}
   private:
       double percent_;
       bool charging_;
   };
   ```

4. (실습) `JointLimit`을 직접 타이핑하되, 이번엔 femur 관절(예: `-0.78 ~ 1.22` 라디안)로 인스턴스를 만들어라. 생성자에 `min_rad >= max_rad`일 때 `std::invalid_argument`를 던지는 검사를 넣고, `try`/`catch`로 실제로 잡히는지 확인하라. 성공 기준: 정상 범위에서는 조용히 생성되고, `min >= max`를 주면 예외 메시지가 출력된다.
5. (실습) `BatteryStatus`에 `const` 멤버 함수 `bool is_low() const`를 추가해 `percent_ < 20.0`을 반환하게 하라. 그 함수 안에서 실수로 `percent_`를 수정하는 줄을 하나 넣어 `-Wall -Wextra`로 컴파일했을 때 나는 에러 메시지를 직접 확인한 뒤, 그 줄을 지워 정상 컴파일되는 것까지 확인하라.
:::

::: answer 해설
1. 표준상 차이는 명시하지 않은 멤버·기저 클래스의 기본 접근 지정자 하나뿐이다(class는 private, struct는 public). 이 책이 불변식 유무로 구분하는 이유는, 캡슐화(private + 검사)가 필요한 타입과 필요 없는 타입을 코드를 열어보지 않고도 선언 키워드만으로 구분하고 싶어서다 — struct를 보면 "이 타입엔 지켜야 할 값 사이 관계가 없다"고 바로 읽힌다.
2. `private`는 `b.percent_ = 9999.0;`처럼 멤버에 직접 접근하는 코드를 컴파일 타임에 막을 뿐이다. `battery_private.cpp`의 `set_percent(double p) { percent_ = p; }`는 정당한 public 통로인데도 아무 검사가 없어서 `b.set_percent(9999.0);`이 그대로 통과한다 — 접근 제어(컴파일 타임)와 값 검증(런타임)은 별개이고, 후자가 없으면 캡슐화는 불변식을 지키지 못한다.
3. 실제 초기화 순서는 `percent_`가 먼저, `charging_`가 나중이다. 리스트에는 `charging_`을 먼저 썼지만(`-Wreorder` 경고 대상), 실행 순서는 항상 **멤버 선언 순서**(`percent_`가 `charging_`보다 먼저 선언됨)를 따르기 때문이다.
4. femur 한계로 `JointLimit femur(-0.78, 1.22);`처럼 만들면 정상 생성된다. `JointLimit bad(1.22, -0.78);`처럼 순서를 뒤집으면 `validate`가 `std::invalid_argument`를 던지고, `catch (const std::invalid_argument& e)`에서 `e.what()`으로 메시지가 잡혀야 한다 — `joint_limit.cpp`의 `bad` 사례와 같은 구조다.
5. `percent_ += 1.0;` 같은 줄을 `is_low() const` 안에 넣으면 `error: assignment of member 'BatteryStatus::percent_' in read-only object`가 난다 — `const_member_fn.cpp`와 동일한 에러다. 그 줄을 지우고 `return percent_ < 20.0;`만 남기면 경고 없이 컴파일된다.
:::

이 절의 클래스는 전부 직접 타이핑해라. 특히 `init_order.cpp`는 리스트 표기 순서를 이리저리 바꿔 가며 `Announce`가 실제로 어떤 순서로 찍히는지 눈으로 확인하고, `assert_ndebug.cpp`는 `-DNDEBUG`를 붙였다 뗐다 하며 같은 프로그램이 다르게 행동하는 것을 직접 봐라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, NDEBUG 비교는 `g++ -std=c++20 -Wall -Wextra -DNDEBUG main.cpp -o main`.

**다음 절**: [3.2 생성자와 소멸자의 모든 것](#/constructors) — 이 절은 생성자를 "초기화 리스트를 쓰는 자리"로만 다뤘다. 다음 절은 생성자가 여러 개일 때 서로를 어떻게 호출하는지(위임 생성자), `explicit`이 왜 필요한지, 여러 멤버·기반 클래스가 얽힌 객체의 생성·소멸 순서 전체를 실측으로 확인한다.
