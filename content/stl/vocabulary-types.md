# 5.9 optional, variant, expected

::: lead
Part V 내내 컨테이너와 알고리즘을 다뤘지만, 정작 "값이 하나 있어야 할 자리에 값이 없을 수도 있다"는 훨씬 흔한 문제는 지금까지 비켜 왔다. 센서를 못 읽었을 수도 있고, 파라미터가 정수일 수도 문자열일 수도 있고, 서비스 호출이 실패할 수도 있다 — 셋 다 "정상적인 경우의 값 하나"만으로는 표현이 안 되는 상황이다. 전통적인 C/C++ 코드는 이걸 널 포인터, 매직 넘버, out-parameter로 억지로 욱여넣어 왔고, 셋 다 나름의 방식으로 새는 그릇이었다. `std::optional`(C++17), `std::variant`(C++17), `std::expected`(C++23)는 이 세 상황 각각을 정확히 표현하는 타입을 표준에 박아 넣은 결과물이다. 이 절이 Part V의 마지막이다 — 여기서 본 세 타입은 특정 라이브러리에 속하지 않고 인터페이스 경계 어디에나 나타나는 **어휘 타입**이라는 공통점으로 마무리한다.
:::

## 값이 없을 수도 있다 — 기존 방법들의 문제

### 널 포인터: 소유권을 시그니처가 말해주지 않는다

관절 각도 제한값을 이름으로 찾는 함수를 생각해 본다. 없으면 `nullptr`를 돌려주는 게 관례처럼 보인다.

```cpp title="p3_null_owner.cpp — nullptr는 두 가지 질문에 답을 안 한다"
#include <iostream>
#include <map>
#include <string>

struct JointLimits { double min_deg, max_deg; };

std::map<std::string, JointLimits> g_limits = {
    {"coxa", {-45.0, 45.0}},
};

// 반환 타입만 보고는 두 가지를 알 수 없다:
// (1) nullptr가 "없음"을 뜻하는가, 다른 에러를 뜻하는가
// (2) 호출자가 이 포인터를 delete 해야 하는가, 그냥 빌린 것인가
const JointLimits* find_limits(const std::string& joint_name) {
    auto it = g_limits.find(joint_name);
    if (it == g_limits.end()) return nullptr;
    return &it->second;
}

int main() {
    const JointLimits* lim = find_limits("coxa");
    if (lim != nullptr) {
        std::cout << "coxa: [" << lim->min_deg << ", " << lim->max_deg << "]\n";
    }
    const JointLimits* missing = find_limits("femur");
    std::cout << "femur 존재 여부: " << (missing != nullptr) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra p3_null_owner.cpp -o p3_null_owner
$ ./p3_null_owner
coxa: [-45, 45]
femur 존재 여부: 0
```

(g++ 13.3 / Linux x86-64 실측.) 이 코드는 경고 없이 컴파일되고 정상 동작한다 — 문제는 런타임에 있지 않고 **타입 그 자체**에 있다. `const JointLimits*`라는 반환 타입만 읽어서는, `nullptr`가 "그런 관절이 없다"는 뜻인지 "찾다가 에러가 났다"는 뜻인지 구분이 안 된다. 여기서는 지도(map) 내부 객체의 주소를 빌려준 것뿐이라 `delete`하면 안 되지만, 다른 함수가 `new`로 만든 객체의 포인터를 돌려주는 경우([2.9](#/unique-ptr) 도입 이전에 흔했던 패턴)라면 호출자가 반드시 해제해야 한다. 같은 타입(`T*`)이 정반대의 계약을 표현할 수 있다는 것 자체가 문제다 — [2.2 포인터](#/pointers)에서 포인터가 "주소 하나"만 담을 뿐 그 주소가 무엇을 뜻하는지는 함수 이름과 주석에만 적혀 있었다는 걸 다시 떠올리면, 이건 그 한계의 연장이다.

### 매직 넘버: 실제 값과 충돌한다

포인터 대신 값 자체에 특별한 의미를 얹는 방법도 있다 — "실패하면 이 특정 숫자를 돌려준다"는 관례다.

```cpp title="p1_magic.cpp — 0.0을 실패 신호로 쓰면 실제 0.0과 구별이 안 된다"
#include <iostream>

double read_joint_velocity(int joint_id, bool sensor_healthy) {
    (void)joint_id;
    if (!sensor_healthy) {
        return 0.0;   // "센서를 못 읽었다"는 뜻으로 쓴 매직 넘버
    }
    return 0.0;       // 관절이 실제로 정지해 있어서 나온 진짜 0.0
}

int main() {
    double v1 = read_joint_velocity(0, false);  // 센서 고장
    double v2 = read_joint_velocity(1, true);   // 센서 정상, 관절 정지

    std::cout << "고장 시 반환값: " << v1 << "\n";
    std::cout << "정지 시 반환값: " << v2 << "\n";
    std::cout << "두 값이 같은가? " << (v1 == v2 ? "true" : "false") << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra p1_magic.cpp -o p1_magic
$ ./p1_magic
고장 시 반환값: 0
정지 시 반환값: 0
두 값이 같은가? true
```

(g++ 13.3 실측.) `v1`과 `v2`가 완전히 같은 값이다 — 그리고 그건 버그가 아니라 코드가 정확히 짠 대로 동작한 결과다. 문제는 값역(value domain) 전체를 실제로 쓸 수 있는 타입에서 "실패"를 표현할 특별한 값을 하나 훔쳐 오는 발상 자체다. 정수 인덱스라면 `-1`을 훔쳐 오는 게 대체로 안전해 보이지만(음수 인덱스가 정상적으로 나올 일이 없으니), 관절 속도나 토크처럼 **범위 전체가 물리적으로 유효한 값**이라면 훔쳐 올 안전한 숫자가 없다. 여기서는 정지 상태(속도 0)가 실제로 흔히 벌어지는 정상 상태라서 충돌이 바로 드러났다.

### out-parameter + bool: 호출부가 지저분해지고, 검사를 빼먹으면 조용히 샌다

값을 매개변수로 채워 받고 성공 여부만 `bool`로 돌려주는 방법도 있다 — 매직 넘버는 피하지만 대가가 있다.

```cpp title="p2_outparam.cpp — 반환값 확인을 빼먹으면 미초기화 값을 그대로 쓴다"
#include <iostream>

bool try_read_joint_velocity(int joint_id, bool sensor_healthy, double& out) {
    if (!sensor_healthy) return false;   // 실패 시 out은 건드리지 않는다
    out = 1.5 * joint_id;
    return true;
}

int main() {
    double v;   // 초기화하지 않는다 -- try_read가 채워줄 거라고 믿는다
    if (try_read_joint_velocity(2, true, v)) {
        std::cout << "읽음: " << v << "\n";
    }

    double v2;  // 마찬가지로 초기화하지 않는다
    try_read_joint_velocity(3, false, v2);   // 반환값(bool)을 확인하지 않고 넘어간다
    std::cout << "확인 없이 그냥 쓴 값: " << v2 << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra p2_outparam.cpp -o p2_outparam
$ ./p2_outparam
읽음: 3
확인 없이 그냥 쓴 값: 0
```

(g++ 13.3 실측 — 컴파일 경고 없음.) 이 실행에서는 `v2`가 우연히 `0`으로 나왔다. **우연이라는 게 핵심이다** — `v2`는 한 번도 초기화되지 않은 지역 변수이고, `try_read_joint_velocity`는 실패 시 `out`을 건드리지 않기로 약속했으니 그 값은 [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 다룬 미정의 동작 그대로다 — 이 환경, 이 컴파일러, 이 최적화 레벨에서는 스택에 남아 있던 값이 우연히 0이었을 뿐, 다른 빌드에서는 임의의 쓰레기 값이 나올 수 있다. `bool` 반환값을 확인하는 걸 코드가 강제하지 않는다는 게 이 패턴의 근본 결함이다 — 컴파일러도 린터도 "이 if를 빼먹었다"고 알려주지 않는다.

세 방법의 공통점은 하나다. **"값이 있다/없다"는 정보가 타입에 없고, 관례와 주석에만 있다.** `std::optional<T>`는 그 정보를 타입 안으로 옮긴다.

## std::optional&lt;T&gt;: 부재를 값으로 표현한다

`read_joint_velocity`를 다시 짠다. 반환 타입이 "이 함수는 값을 못 낼 수도 있다"는 것 자체를 말해준다.

```cpp title="opt1_basic.cpp — has_value()와 operator bool"
#include <iostream>
#include <optional>

std::optional<double> read_joint_velocity(int joint_id, bool sensor_healthy) {
    (void)joint_id;
    if (!sensor_healthy) return std::nullopt;   // 없음을 값이 아니라 타입으로 표현
    return 0.0;   // 관절이 정지해 있어도 이 0.0은 "진짜 값"이다
}

int main() {
    auto v1 = read_joint_velocity(0, false);
    auto v2 = read_joint_velocity(1, true);

    std::cout << "고장 시 has_value(): " << v1.has_value() << "\n";
    std::cout << "정지 시 has_value(): " << v2.has_value() << ", 값 = " << *v2 << "\n";
    std::cout << "고장 시 bool 변환: " << (v1 ? "값 있음" : "값 없음") << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra opt1_basic.cpp -o opt1_basic
$ ./opt1_basic
고장 시 has_value(): 0
정지 시 has_value(): 1, 값 = 0
고장 시 bool 변환: 값 없음
```

(g++ 13.3 실측.) `read_joint_velocity(1, true)`가 낸 `0.0`은 `p1_magic.cpp`의 `0.0`과 겉보기엔 같은 숫자지만, 이번엔 `has_value() == true`가 그 값이 "진짜 읽힌 값"이라고 타입 수준에서 보증한다. 실패했을 때는 `has_value()`가 `false`이고 `operator bool`(`if (v1)`)도 같은 답을 준다 — `if`문 안에서 `has_value()`를 쓸지 `bool` 변환을 쓸지는 취향 문제고, 관례상 `if (v1)` 쪽을 더 많이 쓴다.

값이 없는데 억지로 꺼내려 하면 어떻게 되는지 확인한다.

```cpp title="opt2_exception.cpp — value()는 없으면 예외를 던진다"
#include <iostream>
#include <optional>
#include <stdexcept>

int main() {
    std::optional<double> v = std::nullopt;

    try {
        std::cout << v.value() << "\n";   // 값이 없는데 value()를 부른다
    } catch (const std::bad_optional_access& e) {
        std::cout << "잡음: " << e.what() << "\n";
    }

    std::cout << "value_or(-1.0) = " << v.value_or(-1.0) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra opt2_exception.cpp -o opt2_exception
$ ./opt2_exception
잡음: bad optional access
value_or(-1.0) = -1
```

(g++ 13.3 실측.) `v.value()`는 값이 없으면 `std::bad_optional_access` 예외를 던진다 — 매직 넘버였다면 조용히 틀린 값을 돌려주고 넘어갔을 상황이 이번엔 명시적인 예외로 드러난다. `value_or(기본값)`은 예외 없이 "없으면 이 기본값을 써라"는 걸 한 줄로 표현한다 — [1.6 함수](#/functions)의 기본 인자와 비슷한 발상을, "값이 실제로 없는 경우"에 적용한 것이다.

`operator*`(역참조, `*v`)도 값을 꺼내는 방법이다 — `v.value()`와 다른 점은 값이 없을 때의 반응이다. `value()`는 예외를 던지지만, `*v`는 값이 없는 상태에서 부르면 **정의되지 않은 동작(UB)**이다. 예외조차 던지지 않고 그냥 잘못된 메모리를 읽는다는 뜻이다.

::: warn operator*는 "이미 확인했다"는 전제로만 써라
`*v`는 `if (v)`나 `v.has_value()`로 값이 있다는 걸 이미 확인한 코드 블록 안에서만 써라 — 그 확인 없이 `*v`를 부르면 [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)의 UB와 같은 부류의 사고가 난다. `value()`가 예외라는 형태로 최소한의 안전망을 주는 반면, `operator*`는 "너가 이미 검사했을 것"이라는 제로 오버헤드 전제 위에서 동작한다 — 검사 비용조차 아끼고 싶을 때만 쓰고, 확신이 없으면 `value()`나 `value_or()`를 써라.
:::

이제 `optional`이 이 안전성을 어떤 대가로 사는지 실측한다. 힙 할당이 있는지, 크기가 얼마나 늘어나는지가 관건이다.

```cpp title="opt3_sizeof.cpp — optional은 값을 인라인으로 담는다"
#include <iostream>
#include <optional>
#include <cstdlib>

int alloc_count = 0;
void* operator new(std::size_t sz) {   // 전역 operator new를 가로채 할당 횟수를 센다
    ++alloc_count;
    return std::malloc(sz);
}

struct Vec3 { double x, y, z; };

int main() {
    std::cout << "sizeof(double)                  = " << sizeof(double) << "\n";
    std::cout << "sizeof(std::optional<double>)   = " << sizeof(std::optional<double>) << "\n";
    std::cout << "sizeof(Vec3)                    = " << sizeof(Vec3) << "\n";
    std::cout << "sizeof(std::optional<Vec3>)     = " << sizeof(std::optional<Vec3>) << "\n";

    alloc_count = 0;
    std::optional<Vec3> maybe_pos = Vec3{1.0, 2.0, 3.0};
    std::cout << "optional<Vec3> 생성 heap alloc  = " << alloc_count << "\n";
    std::cout << "maybe_pos->x = " << maybe_pos->x << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra opt3_sizeof.cpp -o opt3_sizeof
$ ./opt3_sizeof
sizeof(double)                  = 8
sizeof(std::optional<double>)   = 16
sizeof(Vec3)                    = 24
sizeof(std::optional<Vec3>)     = 32
optional<Vec3> 생성 heap alloc  = 0
maybe_pos->x = 1
```

(g++ 13.3 / x86-64 실측.) `optional<Vec3>` 생성에 힙 할당이 **0회** 찍혔다 — `optional<T>`는 `unique_ptr`처럼 힙 어딘가를 가리키는 게 아니라, `T`의 값 자체와 "값이 있다"는 표시(`bool` 하나)를 **인라인으로**, 즉 그 `optional` 객체 자신의 메모리 안에 통째로 담는다. 크기 변화도 그 구조를 그대로 보여준다 — `double`(8바이트)은 `optional<double>`이 되면 16바이트, `Vec3`(24바이트)는 `optional<Vec3>`이 되면 32바이트다. 둘 다 정확히 **8바이트가 늘었다** — `bool` 하나는 1바이트면 충분하지만, `double`의 정렬 요구(`alignof(double) == 8`)를 지키려고 8바이트 단위로 반올림되면서 남는 공간이 패딩으로 낭비된다. [2.12 객체 메모리 레이아웃과 정렬](#/object-layout)에서 본 정렬 규칙이 여기서도 그대로 적용된다 — `optional`은 마법이 아니라 "값 하나 + bool 하나"를 담은 평범한 구조체이고, 그 구조체도 같은 정렬 규칙을 따른다.

## std::variant&lt;Ts...&gt;: 여러 타입 중 정확히 하나

값이 있고 없고의 문제가 아니라, **여러 타입 중 정확히 하나**를 담아야 하는 경우도 있다 — ROS 2 파라미터가 대표적이다. 파라미터 하나의 값은 불리언일 수도, 정수일 수도, 실수일 수도, 문자열일 수도 있다. C에서라면 `union` + 타입 태그를 손으로 짜야 했던 이 문제를, `std::variant`는 타입 안전하게 표준화한다.

```cpp title="var1_basic.cpp — get<T>과 get_if<T>"
#include <iostream>
#include <variant>
#include <string>

int main() {
    std::variant<int64_t, double, std::string> param;

    param = int64_t(42);
    std::cout << "int64_t: " << std::get<int64_t>(param) << "\n";

    param = std::string("odom");
    std::cout << "string: " << std::get<std::string>(param) << "\n";

    if (auto* p = std::get_if<int64_t>(&param)) {
        std::cout << "지금 int64_t: " << *p << "\n";
    } else {
        std::cout << "지금은 int64_t가 아니다 (index=" << param.index() << ")\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra var1_basic.cpp -o var1_basic
$ ./var1_basic
int64_t: 42
string: odom
지금은 int64_t가 아니다 (index=2)
```

(g++ 13.3 실측.) `std::get<T>(param)`은 지금 담긴 타입을 정확히 알고 있을 때 쓴다. 확신이 없다면 `std::get_if<T>(&param)`을 쓴다 — 타입이 안 맞으면 예외 대신 `nullptr`를 돌려주고, `if`로 자연스럽게 분기할 수 있다. `param.index()`는 지금 몇 번째 대안 타입이 들어 있는지(0부터, 템플릿 인자 순서대로)를 정수로 알려준다 — 여기서는 `string`이 세 번째(인덱스 2)라서 `2`가 찍혔다.

타입을 확신하지 못한 채로 `std::get`을 부르면 어떻게 되는지 재현한다.

```cpp title="var2_exception.cpp — 잘못된 타입으로 get하면 예외가 난다"
#include <iostream>
#include <variant>
#include <string>

int main() {
    std::variant<int64_t, double, std::string> param = std::string("odom");

    try {
        int64_t x = std::get<int64_t>(param);   // 지금 담긴 건 string인데 int64_t로 꺼낸다
        std::cout << x << "\n";
    } catch (const std::bad_variant_access& e) {
        std::cout << "잡음: " << e.what() << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra var2_exception.cpp -o var2_exception
$ ./var2_exception
잡음: std::get: wrong index for variant
```

(g++ 13.3 실측.) `get<T>`은 지금 담긴 타입이 아니면 `std::bad_variant_access`를 던진다 — 어떤 타입이 대신 들어 있었는지는 알려주지 않지만, 최소한 "이건 네가 생각한 그 타입이 아니다"라는 사실만은 예외 없이 조용히 넘어가지 않는다는 것을 보증한다.

`if`/`else if`를 타입 개수만큼 늘어놓는 대신, `std::visit`으로 "모든 경우를 다 처리했는지"를 컴파일러가 검사하게 만들 수 있다. 방문자(visitor)를 여러 개의 람다로 조립하는 관용구가 실전에서 가장 많이 쓰인다.

```cpp title="var3_visit.cpp — std::visit과 오버로드 세트로 ROS 2 파라미터를 흉내낸다"
#include <iostream>
#include <variant>
#include <string>
#include <vector>
#include <cstdint>

using ParamValue = std::variant<bool, int64_t, double, std::string>;

template<class... Ts> struct Overloaded : Ts... { using Ts::operator()...; };
template<class... Ts> Overloaded(Ts...) -> Overloaded<Ts...>;   // C++17 CTAD

void print_param(const std::string& name, const ParamValue& v) {
    std::visit(Overloaded{
        [&](bool b)               { std::cout << name << " = " << (b ? "true" : "false") << " (bool)\n"; },
        [&](int64_t i)            { std::cout << name << " = " << i << " (int64_t)\n"; },
        [&](double d)             { std::cout << name << " = " << d << " (double)\n"; },
        [&](const std::string& s) { std::cout << name << " = \"" << s << "\" (string)\n"; },
    }, v);
}

int main() {
    std::vector<std::pair<std::string, ParamValue>> params = {
        {"use_sim_time", true},
        {"max_leg_speed", 3.5},
        {"leg_count", int64_t(6)},
        {"robot_name", std::string("hexpider")},
    };
    for (const auto& [name, v] : params) print_param(name, v);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra var3_visit.cpp -o var3_visit
$ ./var3_visit
use_sim_time = true (bool)
max_leg_speed = 3.5 (double)
leg_count = 6 (int64_t)
robot_name = "hexpider" (string)
```

(g++ 13.3 실측.) `Overloaded`는 여러 람다를 다중 상속해 `operator()`를 전부 끌어오는 트릭이다 — [4.1 함수 템플릿](#/function-templates)의 파라미터 팩과 [4.7 auto, decltype](#/type-deduction)의 CTAD(클래스 템플릿 인자 추론)가 여기서 합쳐진다. `std::visit`은 `param`에 지금 들어 있는 타입에 맞는 람다를 정확히 하나 골라 호출한다 — 네 가지 타입 중 하나라도 람다를 안 만들어 뒀다면, 런타임이 아니라 **컴파일 타임에** "이 오버로드 세트로는 처리 못 하는 대안이 있다"는 에러가 난다. `if (auto* p = get_if<bool>(&v))`를 네 번 늘어놓는 것과 결과는 같지만, 새로운 대안 타입을 하나 추가했는데 람다 하나를 빠뜨리면 그 실수를 컴파일러가 그 자리에서 잡아 준다는 게 차이다.

크기를 실측한다 — `union`처럼 가장 큰 대안만큼만 차지하는지 확인한다.

```cpp title="var4_sizeof.cpp — variant는 가장 큰 대안 + 판별 태그만큼 커진다"
#include <iostream>
#include <variant>
#include <string>

struct Big { double arr[10]; };  // 80바이트

int main() {
    std::cout << "sizeof(int64_t)                                = " << sizeof(int64_t) << "\n";
    std::cout << "sizeof(double)                                 = " << sizeof(double) << "\n";
    std::cout << "sizeof(std::string)                            = " << sizeof(std::string) << "\n";
    std::cout << "sizeof(Big)                                    = " << sizeof(Big) << "\n";
    std::cout << "---\n";
    std::cout << "sizeof(variant<int64_t,double>)                = " << sizeof(std::variant<int64_t,double>) << "\n";
    std::cout << "sizeof(variant<int64_t,double,std::string>)    = " << sizeof(std::variant<int64_t,double,std::string>) << "\n";
    std::cout << "sizeof(variant<int64_t,double,std::string,Big>)= " << sizeof(std::variant<int64_t,double,std::string,Big>) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra var4_sizeof.cpp -o var4_sizeof
$ ./var4_sizeof
sizeof(int64_t)                                = 8
sizeof(double)                                 = 8
sizeof(std::string)                            = 32
sizeof(Big)                                    = 80
---
sizeof(variant<int64_t,double>)                = 16
sizeof(variant<int64_t,double,std::string>)    = 40
sizeof(variant<int64_t,double,std::string,Big>)= 88
```

(g++ 13.3 실측.) 대안이 `{int64_t, double}`일 때는 16바이트(가장 큰 대안 8바이트 + 판별 태그, 8바이트 단위로 반올림), `std::string`(32바이트)이 추가되자 40바이트, `Big`(80바이트)까지 추가되자 88바이트가 됐다 — 세 경우 모두 **"가장 큰 대안의 크기를 정렬 단위로 올림한 값"**과 정확히 일치한다. `variant`는 대안 타입 개수와 무관하게, 그 순간 담긴 타입 하나만큼의 공간과 "지금 몇 번째 대안인가"를 가리키는 태그 하나만 쓴다 — `optional<T>`가 "값 하나 + bool 하나"였던 것과 같은 원리를, 대안이 둘 이상인 경우로 확장한 것뿐이다.

::: interview optional/variant가 왜 유니온보다 안전한가
"C의 `union`과 `std::variant`의 차이"는 STL 설계 이해도를 보는 전형적인 질문이다. 답변 뼈대: ① `union`은 지금 어떤 멤버가 활성 상태인지 타입 시스템이 추적하지 않는다 — 잘못된 멤버로 읽어도 컴파일러도 런타임도 막지 못하는 UB다. `variant`는 내부에 판별 태그를 실제로 들고 있어(이 절의 실측대로 그 태그가 크기에 반영된다) `get<T>`/`get_if<T>`가 지금 담긴 타입을 실제로 검사한다. ② `union`은 비trivial 타입(소멸자가 있는 `std::string` 등)을 멤버로 두면 생성자·소멸자를 손으로 관리해야 한다 — `variant`는 지금 담긴 대안의 소멸자를 자동으로 정확히 호출한다. ③ `optional<T>`도 같은 계열이다 — "값이 있는 상태"와 "없는 상태"를 놓고 union과 똑같은 문제(지금 유효한 멤버가 뭔지 타입이 안 알려줌)를 `bool` 플래그로 해결한 것으로 설명하면 두 타입을 하나의 원리로 묶어 답한 것이 된다.
:::

## std::expected&lt;T, E&gt; (C++23): 예외 없이 실패를 값으로

서비스 호출처럼 "성공하면 결과, 실패하면 그 이유"를 표현해야 하는 경우가 있다. 예외를 던지는 것도 방법이지만, 예외는 호출부에서 강제로 처리하게 만들지 않고(`try`/`catch`를 안 써도 컴파일된다), 던지고 잡는 비용이 실패가 흔한 경로(네트워크 타임아웃, 서비스 거부처럼 "정상적으로 일어날 수 있는 실패")에는 부담스러울 수 있다. `std::expected<T, E>`는 성공값 `T`와 실패값 `E`를 `optional`과 비슷한 모양으로 감싸되, "실패했다"는 사실과 그 이유를 **예외가 아니라 반환값**으로 돌려준다.

이 표준 기능이 실제로 이 환경에서 쓸 수 있는지부터 실측한다.

```cpp title="featuretest.cpp — <expected>가 이 환경에서 실제로 되는지 확인한다"
#include <expected>
#include <iostream>

int main() {
#ifdef __cpp_lib_expected
    std::cout << "__cpp_lib_expected = " << __cpp_lib_expected << "\n";
#else
    std::cout << "__cpp_lib_expected not defined\n";
#endif
    std::cout << "__cplusplus = " << __cplusplus << "\n";
}
```

```console
$ g++ -std=c++20 featuretest.cpp -o ft20 && ./ft20
__cpp_lib_expected not defined
__cplusplus = 202002

$ g++ -std=c++23 featuretest.cpp -o ft23 && ./ft23
__cpp_lib_expected = 202211
__cplusplus = 202100
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 실측.) `-std=c++20`으로는 `<expected>` 헤더 자체는 `#include` 되지만 `__cpp_lib_expected` 매크로가 정의되지 않는다 — `std::expected` 타입을 실제로 써 보면 이게 무슨 뜻인지 더 분명해진다.

```console
$ g++ -std=c++20 -Wall -Wextra exp_check20b.cpp -o exp_check20b
exp_check20b.cpp:2:6: error: 'expected' in namespace 'std' does not name a template type
    2 | std::expected<int, int> f() { return 1; }
      |      ^~~~~~~~
exp_check20b.cpp:2:1: note: 'std::expected' is only available from C++23 onwards
```

(g++ 13.3 실측.) 컴파일러가 직접 "C++23부터 쓸 수 있다"고 알려준다. `-std=c++23`으로 바꾸면 `__cpp_lib_expected`가 `202211`(C++23 표준의 `expected` 확정 버전을 가리키는 값)로 정의되고, 실제 코드도 컴파일·실행된다 — **이 환경(g++ 13.3.0, Ubuntu 24.04, x86-64)에서는 `-std=c++23`을 붙이면 `std::expected`를 그대로 쓸 수 있다.** 다른 컴파일러 버전에서는 이 결과가 다를 수 있으니, 프로젝트에 도입하기 전에는 항상 이 절의 방법 그대로(`__cpp_lib_expected` 매크로 확인, 또는 그냥 컴파일해서 에러 메시지 확인) 먼저 실측해라.

```cpp title="exp1_basic.cpp — 성공하면 각도, 실패하면 이유를 값으로 돌려준다"
#include <expected>
#include <iostream>
#include <string>

enum class ServiceError { Timeout, Disconnected, Rejected };

std::string to_string(ServiceError e) {
    switch (e) {
        case ServiceError::Timeout:      return "Timeout";
        case ServiceError::Disconnected: return "Disconnected";
        case ServiceError::Rejected:     return "Rejected";
    }
    return "Unknown";
}

// 성공하면 각도(double), 실패하면 이유(ServiceError)를 담는다 -- 예외를 던지지 않는다
std::expected<double, ServiceError> call_set_joint_angle(double angle, bool link_up) {
    if (!link_up) {
        return std::unexpected(ServiceError::Disconnected);
    }
    if (angle < -90.0 || angle > 90.0) {
        return std::unexpected(ServiceError::Rejected);
    }
    return angle;   // 성공 -- 실제로 반영된 각도
}

int main() {
    auto ok = call_set_joint_angle(30.0, true);
    auto down = call_set_joint_angle(30.0, false);
    auto bad = call_set_joint_angle(999.0, true);

    for (auto* r : {&ok, &down, &bad}) {
        if (r->has_value()) {
            std::cout << "성공: " << r->value() << "도\n";
        } else {
            std::cout << "실패: " << to_string(r->error()) << "\n";
        }
    }
    return 0;
}
```

```console
$ g++ -std=c++23 -Wall -Wextra exp1_basic.cpp -o exp1_basic
$ ./exp1_basic
성공: 30도
실패: Disconnected
실패: Rejected
```

(g++ 13.3 실측.) `std::unexpected(값)`으로 실패를 감싸 반환하고, 호출부는 `has_value()`로 성공 여부를 먼저 확인한 뒤 `value()`(성공값) 또는 `error()`(실패값)를 꺼낸다 — 인터페이스 모양이 `optional`과 의도적으로 닮았다. 차이는 `optional`이 "값이 없다"는 사실 하나만 표현하는 반면, `expected`는 "실패했다"에 더해 **왜 실패했는지**까지 타입에 실어 나른다는 것이다. 호출부가 `try`/`catch`를 준비하지 않아도 이 코드는 컴파일되고 실행되지만, `r->error()`를 부르기 전에 `has_value()`를 확인하지 않으면 (그리고 실제로 실패 상태였다면) `optional`의 `operator*`와 마찬가지로 잘못된 상태를 읽게 된다 — 안전망이 필요하면 `value()`를 예외 던지는 버전으로 쓸 수도 있다(`bad_expected_access`를 던진다).

## 어휘 타입이라는 공통점

`optional`, `variant`, `expected` 세 타입은 서로 다른 문제를 풀지만 공통점이 하나 있다 — 이 절 내내 본 것처럼, 셋 다 어떤 특정 라이브러리나 도메인에 종속되지 않고 **인터페이스 경계에서 의도를 명확히 표현하기 위해 표준에 들어온 타입**이다. `std::string`이 "텍스트를 담는다"는 의도를 표현하는 것처럼, 이 세 타입은 "값이 없을 수 있다", "여러 타입 중 하나다", "실패할 수 있고 그 이유가 있다"는 의도를 함수 시그니처만 보고 알 수 있게 만든다. 이런 성격의 타입을 **어휘 타입(vocabulary type)**이라고 부른다 — 특정 라이브러리의 클래스가 아니라, 여러 라이브러리가 서로 대화할 때 공통으로 쓰는 "단어"라는 뜻이다. [5.8 string_view와 span](#/views)에서 본 두 뷰 타입도 같은 성격이다 — "이 함수는 소유권 없이 읽기만 한다"는 의도를 타입으로 못박은 것이다.

이 절이 Part V의 마지막이다. [5.1 vector](#/vector)에서 자료구조의 내부 비용을 실측하는 것으로 시작해, [5.4 반복자](#/iterators)와 [5.5 algorithm](#/algorithms)으로 그 자료구조를 도는 일관된 방법을 봤고, [5.6 람다](#/lambdas)와 [5.7 std::function](#/callables)으로 "무엇을 할지"를 값으로 넘기는 법을 익혔고, [5.8 뷰](#/views)와 이 절의 어휘 타입으로 "소유권 없이 읽는다"와 "이 자리엔 값이 없을 수도 있다"는 의도를 타입으로 표현하는 데까지 왔다. 다섯 절 모두 결국 하나의 질문으로 수렴한다 — **이 데이터를 누가 소유하고, 어떻게 순회하고, 그 값이 정말 있다고 믿어도 되는가.** Part VI부터는 이 질문에 "동시에 여러 스레드가 접근한다면"이라는 조건이 하나 더 붙는다.

::: tip 로봇 코드에 세 타입을 놓는 자리
센서 읽기 실패는 `optional`의 정석 자리다 — IMU나 라이다가 타임아웃 없이 순간적으로 응답을 못 준 경우, `read_imu()`가 `std::optional<ImuData>`를 돌려주면 호출부는 "값이 없다"만 확인하면 되고 굳이 실패 사유까지 알 필요는 없다. ROS 2 파라미터처럼 "이 값의 타입이 여러 개 중 하나"인 자리는 `variant`가 정확히 맞는다 — 실제로 `rclcpp`의 파라미터 시스템도 불리언·정수·실수·문자열 등 여러 타입 중 하나를 담아야 한다는, 이 절의 `ParamValue`와 똑같은 모양의 문제를 갖고 있다. 서비스 호출처럼 "실패했다면 왜 실패했는지"까지 호출부가 알아야 하는 자리는 `expected`가 맞다 — 특히 [6.8 실시간 제약](#/realtime)에서 다루게 될 이유로, 실시간 제어 루프 안에서는 예외를 던지고 잡는 비용 자체가 부담일 수 있다. 값으로 실패를 돌려주면 그 비용 없이 같은 정보를 전달할 수 있다.
:::

## 요약

- 널 포인터·매직 넘버·out-parameter + bool은 전부 "값이 없을 수도 있다"를 값 자체나 관례로 표현한다 — 소유권 계약이 시그니처에 안 드러나거나(실측: `p3_null_owner.cpp`), 실제 유효한 값과 충돌하거나(실측: `p1_magic.cpp`, 두 반환값이 같음), 반환값 확인을 빼먹으면 미초기화 값을 조용히 쓰게 된다(실측: `p2_outparam.cpp`).
- `std::optional<T>`(C++17)는 "값이 없다"를 타입으로 표현한다 — `has_value()`/`operator bool`로 확인하고, `value()`는 없으면 `std::bad_optional_access`를 던지며(실측), `value_or()`는 예외 없이 기본값을 쓴다. `operator*`는 확인 없이 부르면 UB다.
- `optional<T>`는 힙 할당이 없다 — 값과 `bool` 플래그를 인라인으로 담는다(실측: `operator new` 후킹으로 할당 0회 확인). 크기는 `sizeof(T)`보다 정렬 단위만큼(실측: `double`·`Vec3` 모두 8바이트) 커진다.
- `std::variant<Ts...>`(C++17)는 여러 타입 중 정확히 하나를 타입 안전하게 담는다 — `get<T>`은 타입이 안 맞으면 `std::bad_variant_access`를 던지고(실측), `get_if<T>`은 `nullptr`로 안전하게 검사한다. `std::visit` + 오버로드 세트는 모든 대안을 처리했는지 컴파일 타임에 검사해 준다.
- `variant`의 크기는 가장 큰 대안 크기를 정렬 단위로 올림한 것과 같다(실측: 대안 조합 세 가지 모두 일치) — union과 달리 지금 담긴 타입을 판별 태그로 실제로 추적한다.
- `std::expected<T, E>`(C++23)는 성공값과 실패 이유를 예외 없이 값으로 돌려준다. g++ 13.3.0은 `-std=c++23`에서만 지원한다(실측: `-std=c++20`은 헤더는 포함되지만 타입이 정의되지 않음, 컴파일러가 "C++23부터 가능"이라고 직접 알려줌).
- 세 타입 모두 특정 라이브러리에 속하지 않고 인터페이스 경계에서 의도를 명확히 하는 **어휘 타입**이다 — [5.8](#/views)의 `string_view`/`span`과 같은 계열이다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 설계 판단, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일로 확인하는 실습이다.

1. `p1_magic.cpp`와 `opt1_basic.cpp`를 근거로, `std::optional<double>`이 "관절이 정지해서 나온 진짜 0.0"과 "센서 고장으로 값을 못 낸 경우"를 어떻게 구별하는지 한 문단으로 설명하라.

2. (예측) 다음 코드를 컴파일하지 말고 무슨 일이 일어날지 예측하고 근거를 써라.

   ```cpp
   std::variant<int, std::string> v = 42;
   std::string s = std::get<std::string>(v);
   ```

3. 서비스 호출 실패를 표현할 때 `std::expected<T, ErrorCode>`를 쓰는 것과, 실패 시 예외를 던지는 것을 비교하라. `expected`가 유리한 지점과 예외가 유리한 지점을 각각 하나씩 들어라(힌트: 실시간 제약, 호출부가 실패를 처리하도록 강제하는 정도).

4. (실습, 코드 작성형) `std::variant<int64_t, double, bool, std::string>` 타입의 파라미터를 5개 이상 담은 `std::vector`를 만들고, `std::visit` + 오버로드 세트로 각 값을 타입에 맞게 출력하는 함수를 작성하라. 그다음 오버로드 세트에서 람다 하나를 일부러 빼고 다시 컴파일해 보라. 성공 기준: 람다 네 개를 모두 갖췄을 때는 정상 컴파일·실행되고, 하나를 뺐을 때는 `g++ -std=c++20`이 런타임이 아니라 **컴파일 타임에** 에러를 낸다는 것을 직접 확인했다.
:::

::: answer 해설
1. `p1_magic.cpp`의 두 반환값은 둘 다 `double` 타입의 `0.0`이라 값만 봐서는 절대 구별할 수 없다. `opt1_basic.cpp`의 `std::optional<double>`은 값 자체와 별개로 "값이 있는가"라는 정보를 타입 안에 따로 들고 있다(이 절 뒤에서 실측한 대로 `bool` 플래그 하나로) — 센서 고장이면 `has_value()`가 `false`인 `std::nullopt`을 돌려주고, 정지 상태의 진짜 `0.0`이면 `has_value()`가 `true`인 `0.0`을 돌려준다. 두 경우 모두 담긴 숫자는 같을 수 있어도 "값이 있다"는 플래그가 다르므로 호출부가 `has_value()`만 확인하면 구별된다.
2. 컴파일되지 않는다. `v`는 지금 `int`(42)를 담고 있는데, `std::get<std::string>(v)`는 컴파일 타임에는 통과하지만(variant의 대안 목록에 `std::string`이 있으므로 문법적으로는 유효한 호출이다) 런타임에 지금 담긴 타입이 `std::string`이 아니므로 `std::bad_variant_access` 예외가 던져진다 — `var2_exception.cpp`와 정확히 같은 패턴이다. "컴파일 에러"와 헷갈리기 쉬운 지점인데, `get<T>`의 타입 검사는 런타임 검사다.
3. `expected`가 유리한 지점: 실패가 "정상적으로 일어날 수 있는 경로"(타임아웃, 연결 끊김처럼 흔한 상황)일 때, 예외를 던지고 잡는 비용(스택 되감기, 예외 처리 런타임 지원) 없이 같은 정보를 값으로 돌려줄 수 있다 — 이 절의 `tip` 박스에서 짚었듯 실시간 제어 루프에서는 이 비용 자체가 부담이 될 수 있다. 예외가 유리한 지점: 실패를 처리하는 코드를 호출부가 명시적으로 준비하지 않아도 컴파일은 되는 `expected`와 달리, 예외는 처리하지 않으면 프로그램이 종료돼 "이 실패를 무시하면 안 된다"는 걸 훨씬 강하게 강제한다 — 정말 예외적인(자주 안 일어나야 정상인) 실패에는 이 강제성이 오히려 맞다.
4. 오버로드 세트에서 람다 하나(예: `bool` 처리)를 빼면, `std::visit`이 그 대안 타입을 처리할 `operator()`를 찾지 못해 컴파일 에러가 난다 — 정확한 메시지는 컴파일러 버전마다 다르지만 g++는 대체로 "no match for call" 계열의 오버로드 해결 실패 메시지를 낸다. 컴파일 타임에 이 실수를 잡는다는 게 `if`/`else if` 체인과의 근본적인 차이다 — 체인이었다면 그 타입을 빼먹은 채로도 조용히 컴파일되고, 런타임에 아무 분기도 안 타는 채로 넘어갔을 것이다.
:::

이 절의 코드는 전부 직접 쳐라. `expected` 관련 코드는 반드시 `-std=c++23`으로 컴파일해라 — `-std=c++20`으로 시도해서 컴파일러가 실제로 어떤 에러 메시지를 내는지도 한 번은 직접 봐 둬라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, `expected` 코드만 `g++ -std=c++23 -Wall -Wextra main.cpp -o main && ./main`.

**다음 절**: [6.1 std::thread: 생성, join, 수명](#/threads) — Part VI로 넘어가, 여러 스레드가 동시에 값을 다룰 때 이 절까지 쌓아 온 소유권·타입 규칙이 왜 더 이상 충분하지 않은지부터 본다.
