# 4.4 가변 인자 템플릿과 폴드 표현식

::: lead
로그 함수 하나를 인자 1개, 2개, 3개짜리로 각각 오버로드해 본 적이 있다면 이미 이 절이 필요한 이유를 안다. C는 이 문제를 `printf`의 `...`(가변 인자)로 풀었지만, 그 대가로 타입 검사를 통째로 포기했다 — 잘못된 포맷 지정자 하나가 조용히 쓰레기 값을 찍는다. [4.1](#/function-templates)에서 본 함수 템플릿은 타입 하나를 받는 문제는 풀어 주지만, "인자가 몇 개인지 모른다"는 문제는 아직 못 푼다. 이 절은 그 빈틈을 메우는 파라미터 팩(parameter pack)과, C++11의 번거로운 재귀 전개를 한 줄로 접어 버리는 C++17 폴드 표현식(fold expression)을 실측으로 따라간다. 마지막에는 이 둘을 [2.7 이동 시맨틱](#/move-semantics)의 값 범주 개념과 엮어 완벽 전달(perfect forwarding)까지 손에 쥔다.
:::

## 오버로드 지옥과 printf의 편법

로봇 다리 상태를 로그로 남기는 함수를 만든다고 하자. 필드가 1개일 수도, 3개일 수도 있다. 템플릿 없이 이 문제를 풀려면 인자 개수별로 오버로드를 늘어놓아야 한다.

```cpp title="overload_hell.cpp"
#include <iostream>

void log_msg(const std::string& a) {
    std::cout << a << "\n";
}
void log_msg(const std::string& a, const std::string& b) {
    std::cout << a << " " << b << "\n";
}
void log_msg(const std::string& a, const std::string& b, const std::string& c) {
    std::cout << a << " " << b << " " << c << "\n";
}

int main() {
    log_msg("start");
    log_msg("leg", "ready");
    log_msg("leg", "3", "ready");
}
```

```console
$ g++ -std=c++20 -Wall -Wextra overload_hell.cpp -o overload_hell
$ ./overload_hell
start
leg ready
leg 3 ready
```

동작은 한다. 그런데 필드가 4개, 5개로 늘어날 때마다 오버로드를 하나씩 손으로 추가해야 하고, 타입도 전부 `std::string`으로 못박혀 있어서 숫자 필드 하나만 섞여도 오버로드가 다시 곱절로 불어난다. C는 이 조합 폭발을 `...`(가변 인자, variadic argument)로 우회했다. `printf`가 그 전형이다.

```cpp title="printf_trap.cpp"
#include <cstdio>

int main() {
    double leg_angle = 47.5;
    // %d 인데 double을 넘긴다 — printf는 형식 문자열과 인자 타입을 컴파일 타임에 맞춰 볼 방법이 없다
    printf("leg angle: %d\n", leg_angle);
    return 0;
}
```

```console
$ g++ -std=c++20 -w printf_trap.cpp -o printf_trap_w
$ ./printf_trap_w
leg angle: -380628024
```

`-w`(모든 경고 끔)로 컴파일하면 에러도 경고도 없이 통과하고, 실행하면 `47.5`가 들어갈 자리에 의미 없는 정수가 찍힌다. `%d`와 `double`이 어긋난 것을 `printf` 자신은 검사하지 않는다 — C의 `...`는 넘어온 인자의 타입 정보를 함수 안에서 완전히 잃어버리기 때문이다. GCC는 `-Wformat`(기본 활성)이라는 별도의 정적 분석기를 얹어 포맷 문자열과 인자를 대조해 경고를 내지만(`-Wall` 없이도 뜬다), 이건 **언어가 보장하는 타입 안전성이 아니라 컴파일러가 얹은 편법 위의 편법**이다. 표준 C++의 타입 시스템은 이 검사에 관여하지 않는다.

```console
$ g++ -std=c++20 printf_trap.cpp -o printf_trap
printf_trap.cpp:6:25: warning: format '%d' expects argument of type 'int', but argument 2 has type 'double' [-Wformat=]
```

파라미터 팩은 이 문제를 근본적으로 다르게 푼다 — 인자 개수를 컴파일 타임에 알고, 각 인자의 **진짜 타입**을 그대로 유지한 채로 넘긴다.

## 파라미터 팩과 sizeof...: 개수를 컴파일 타임에 안다

파라미터 팩은 문법이 딱 하나 늘어난 함수 템플릿이다. `typename` 뒤에 `...`을 붙이면 "타입이 0개 이상 임의 개수로 온다"는 뜻이 되고, 함수 파라미터 쪽에도 같은 자리에 `...`을 붙인다.

```cpp title="pack_count.cpp"
#include <iostream>

template <typename... Args>
void count_args(Args... /*args*/) {
    std::cout << "인자 개수: " << sizeof...(Args) << "\n";
}

int main() {
    count_args();
    count_args(1);
    count_args(1, 2.5, "leg");
    count_args(1, 2, 3, 4, 5);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra pack_count.cpp -o pack_count
$ ./pack_count
인자 개수: 0
인자 개수: 1
인자 개수: 3
인자 개수: 5
```

`sizeof...(Args)`는 `sizeof`와 이름만 비슷할 뿐 완전히 다른 연산자다. `sizeof(T)`가 타입 하나의 바이트 크기를 재는 것과 달리, `sizeof...(Args)`는 **팩에 담긴 타입의 개수**를 컴파일 타임 상수로 돌려준다. 그리고 이건 함수 오버로드가 아니다 — `count_args()`, `count_args(1)`, `count_args(1, 2.5, "leg")`는 서로 다른 오버로드를 호출한 게 아니라 **하나의 템플릿이 인자 개수·타입 조합마다 각각 인스턴스화된 것**이다. [4.3](#/template-mechanics)에서 확인한 "인스턴스화는 호출부에서 일어난다"는 규칙이 여기서도 그대로 적용된다 — 팩의 길이 자체가 템플릿 인자의 일부이기 때문에, 길이가 다르면 별개의 인스턴스가 찍힌다.

## 재귀 전개: C++11이 인자를 하나씩 벗겨내는 방식

개수를 세는 것과 달리, 팩의 **내용물**을 하나씩 꺼내 쓰려면 C++11에는 반복문이 없다. 대신 재귀로 푼다 — 팩의 맨 앞(head)을 떼어 처리하고, 나머지(tail)를 다시 같은 함수에 넘긴다.

```cpp title="log_recursive.cpp"
#include <iostream>

// 재귀 종료 조건: 파라미터 팩이 빈 경우를 받는 오버로드
void log_msg() {
    std::cout << "\n";
}

// 헤드(first) / 테일(rest...) 분리 — first를 찍고 나머지로 재귀
template <typename T, typename... Rest>
void log_msg(const T& first, const Rest&... rest) {
    std::cout << first << " ";
    log_msg(rest...);
}

int main() {
    log_msg("leg", 3, "ready", 47.5);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra log_recursive.cpp -o log_recursive
$ ./log_recursive
leg 3 ready 47.5
```

`log_msg("leg", 3, "ready", 47.5)`가 호출되면 `T = const char*`, `Rest = {int, const char*, double}`로 인스턴스화되어 `"leg"`를 찍고 `log_msg(3, "ready", 47.5)`를 부른다. 이 호출이 다시 `T = int`로 인스턴스화되어 `3`을 찍고 나머지를 넘긴다 — 이렇게 팩이 한 겹씩 벗겨지다가 마지막에 인자가 0개인 `log_msg(rest...)` 호출이 남는다. 이 마지막 호출을 받아 줄 함수가 없으면 컴파일이 깨진다.

```cpp title="log_recursive_nobase.cpp"
#include <iostream>

// 종료 조건 오버로드를 일부러 뺐다
template <typename T, typename... Rest>
void log_msg(const T& first, const Rest&... rest) {
    std::cout << first << " ";
    log_msg(rest...);
}

int main() {
    log_msg("leg", 3, "ready");
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c log_recursive_nobase.cpp
log_recursive_nobase.cpp: In instantiation of 'void log_msg(const T&, const Rest& ...) [with T = char [6]; Rest = {}]':
log_recursive_nobase.cpp:7:12:   recursively required from 'void log_msg(const T&, const Rest& ...) [with T = int; Rest = {char [6]}]'
log_recursive_nobase.cpp:7:12:   required from 'void log_msg(const T&, const Rest& ...) [with T = char [4]; Rest = {int, char [6]}]'
log_recursive_nobase.cpp:11:12:   required from here
log_recursive_nobase.cpp:7:12: error: no matching function for call to 'log_msg()'
```

에러 메시지의 `recursively required from` 사슬이 정확히 재귀 인스턴스화가 한 단계씩 벗겨진 흔적이다. `Rest = {}`(빈 팩)로 인스턴스화된 마지막 단계에서 `log_msg()`를 받아 줄 함수가 없어 `no matching function`이 난다. **재귀 전개는 항상 이 종료 조건용 오버로드를 별도로 준비해야 한다** — 로직과 무관한 상용구가 팩을 다루는 함수마다 하나씩 따라붙는 게 C++11 스타일의 실질적인 번거로움이다.

## 폴드 표현식: C++17이 재귀를 지운다

C++17은 이 재귀 짝 없이 팩 전체를 한 표현식으로 펼치는 문법을 추가했다. **폴드 표현식**은 팩과 이항 연산자를 괄호 안에 `...`과 함께 적는다. 가장 단순한 형태는 단항 폴드다.

```cpp title="fold_basic.cpp"
#include <iostream>

// 단항 우측 폴드: (args + ...) -> args1 + (args2 + (args3 + ...))
template <typename... Args>
auto sum_all(Args... args) {
    return (args + ...);
}

int main() {
    std::cout << sum_all(1, 2, 3, 4) << "\n";
    std::cout << sum_all(1.5, 2.5) << "\n";
}
```

```console
$ g++ -std=c++20 -Wall -Wextra fold_basic.cpp -o fold_basic
$ ./fold_basic
10
4
```

`(args + ...)` 한 줄이 재귀 함수 두 개(본체 + 종료 조건)를 대체한다. 그런데 `...`을 어느 쪽에 두느냐가 실제로 결과를 바꾼다 — 덧셈처럼 결합 순서를 안 타는 연산에서는 안 보이지만, 뺄셈처럼 순서에 따라 값이 달라지는 연산에서는 바로 드러난다.

```cpp title="fold_order.cpp"
#include <iostream>

// 단항 우측 폴드(right fold): args1 - (args2 - (args3 - ...))
template <typename... Args>
auto sub_right(Args... args) {
    return (args - ...);
}

// 단항 좌측 폴드(left fold): ((args1 - args2) - args3) - ...
template <typename... Args>
auto sub_left(Args... args) {
    return (... - args);
}

int main() {
    std::cout << "우측 폴드 (10 - (5 - 2)): " << sub_right(10, 5, 2) << "\n";
    std::cout << "좌측 폴드 ((10 - 5) - 2): " << sub_left(10, 5, 2) << "\n";
}
```

```console
$ g++ -std=c++20 -Wall -Wextra fold_order.cpp -o fold_order
$ ./fold_order
우측 폴드 (10 - (5 - 2)): 7
좌측 폴드 ((10 - 5) - 2): 3
```

같은 인자 `(10, 5, 2)`인데 결과가 `7`과 `3`으로 갈린다. `...`이 팩의 **오른쪽**에 붙으면(`args - ...`) 결합이 오른쪽부터 묶이고(`10 - (5 - 2)`), **왼쪽**에 붙으면(`... - args`) 왼쪽부터 묶인다(`(10 - 5) - 2`). 뺄셈·나눗셈처럼 결합 법칙이 성립하지 않는 연산자를 팩에 쓸 때는 이 방향을 반드시 의도적으로 골라야 한다.

여기에 초기값을 하나 더 붙이면 **이항 폴드**가 된다 — 팩이 비어 있을 때도(`sizeof...(Args) == 0`) 값이 정의되도록 시작점을 명시하는 형태다.

```cpp title="sizeof_pack.cpp"
#include <iostream>

template <typename... Args>
void show_sizes(Args... /*args*/) {
    std::cout << "개수: " << sizeof...(Args) << "\n";
    // 이항 폴드: (pack + ... + init) — sizeof(Args)...는 각 타입 크기를 나열한 팩
    std::cout << "타입 크기 합: " << (sizeof(Args) + ... + 0) << "\n";
}

int main() {
    show_sizes(1, 2.5, 'a');   // int(4) + double(8) + char(1)
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sizeof_pack.cpp -o sizeof_pack
$ ./sizeof_pack
개수: 3
타입 크기 합: 13
```

`sizeof(Args)...`는 `sizeof...(Args)`와 전혀 다른 것을 만든다는 점에 주의해라. `sizeof...(Args)`는 개수 하나(정수)를 내놓지만, `sizeof(Args)...`는 각 타입의 `sizeof`를 나열한 **팩**을 만든다 — `int, double, char` 세 타입이면 `4, 8, 1`이라는 팩이 생기고, 이걸 `(... + 0)`으로 접어야 비로소 숫자 하나(13)가 나온다. `+ 0`이 붙은 이유는 팩이 비었을 때(`sizeof...(Args) == 0`)도 `(... + 0)`이 `0`으로 무너지게 하기 위해서다 — 초기값 없는 단항 폴드였다면 빈 팩에서 어떤 항등원을 써야 할지 컴파일러가 알 방법이 없어 컴파일 에러가 난다.

이제 재귀 버전 로그 함수를 폴드 표현식으로 다시 쓴다. 종료 조건용 오버로드가 통째로 사라진다.

```cpp title="log_fold.cpp"
#include <iostream>

// 이항 폴드에 콤마 연산자를 태워 "각 인자를 순서대로 출력하라"를 표현한다.
template <typename... Args>
void log_msg(const Args&... args) {
    ((std::cout << args << " "), ...);
    std::cout << "\n";
}

int main() {
    log_msg("leg", 3, "ready", 47.5);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra log_fold.cpp -o log_fold
$ ./log_fold
leg 3 ready 47.5
```

`log_recursive.cpp`는 함수 두 개(재귀 본체 + 빈 팩용 오버로드)로 이 동작을 만들었다. `log_fold.cpp`는 함수 하나, 그것도 본문 한 줄로 같은 결과를 낸다 — 재귀 호출도, 종료 조건도 없다. `(std::cout << args << " ")`가 각 인자에 대해 펼쳐지고, 그 사이를 콤마 연산자가 이어 붙인다.

::: warn 폴드가 못 하는 것
폴드 표현식은 팩의 **모든 원소에 같은 연산을 순서대로** 적용하는 것만 표현한다. 원소마다 다른 처리를 하고 싶거나(짝수 번째만 대문자로), 팩 중간에서 조기 종료를 하고 싶다면 폴드 하나로는 안 되고 재귀나 `if constexpr`([4.6](#/constexpr) 예고편)로 되돌아가야 한다. "펼치기"와 "제어 흐름"은 다른 문제다.
:::

## 완벽 전달 맛보기: 팩을 그대로 넘기면 값 범주가 사라진다

파라미터 팩을 다른 함수로 그대로 전달하는 래퍼를 만들 때가 있다 — 로깅 데코레이터, 팩토리 함수가 전형적이다. 이때 [2.7](#/move-semantics)에서 배운 값 범주(lvalue/rvalue) 구분을 유지한 채로 넘기지 않으면, 안쪽 함수는 원래 rvalue였던 인자도 lvalue로 오해한다.

```cpp title="forward_broken.cpp"
#include <iostream>

void take(int& x)  { std::cout << "좌값 버전: " << x << "\n"; }
void take(int&& x) { std::cout << "우값 버전: " << x << "\n"; }

// std::forward 없이 그냥 넘긴다 — args는 이름이 붙은 변수라 항상 lvalue다
template <typename... Args>
void wrapper_broken(Args&&... args) {
    take(args...);
}

int main() {
    int a = 10;
    wrapper_broken(a);
    wrapper_broken(20);   // 20은 우값으로 넘겼는데
}
```

```console
$ g++ -std=c++20 -Wall -Wextra forward_broken.cpp -o forward_broken
$ ./forward_broken
좌값 버전: 10
좌값 버전: 20
```

`wrapper_broken(20)`은 분명히 우값 `20`을 넘겼는데 안에서는 `좌값 버전`이 호출된다. 이유는 간단하다 — `Args&&... args`로 받는 순간 `args`는 함수 안에서 이름이 붙은 변수가 되고, **이름이 있는 것은 항상 lvalue**다(원래 rvalue였다는 사실은 타입에만 남고 값 범주에서는 사라진다). 이걸 되살리는 도구가 `std::forward`다.

```cpp title="forward_demo.cpp"
#include <iostream>
#include <utility>

void take(int& x)  { std::cout << "좌값 버전: " << x << "\n"; }
void take(int&& x) { std::cout << "우값 버전: " << x << "\n"; }

// Args&&... 는 전달 레퍼런스(forwarding reference) — T가 추론될 때만 성립한다
template <typename... Args>
void wrapper(Args&&... args) {
    take(std::forward<Args>(args)...);
}

int main() {
    int a = 10;
    wrapper(a);   // a는 좌값 -> take(int&)
    wrapper(20);  // 20은 우값 -> take(int&&)
}
```

```console
$ g++ -std=c++20 -Wall -Wextra forward_demo.cpp -o forward_demo
$ ./forward_demo
좌값 버전: 10
우값 버전: 20
```

`std::forward<Args>(args)...`가 팩의 각 원소에 대해 "원래 lvalue였으면 lvalue로, rvalue였으면 rvalue로 되돌려 넘겨라"를 수행한다. `Args&&`는 여기서 [2.7](#/move-semantics)의 `T&&`(rvalue 레퍼런스)와 겉모습만 같다 — 템플릿 파라미터가 그 자리에서 추론될 때만 `T&&`는 lvalue·rvalue를 다 받는 **전달 레퍼런스**로 동작한다. 이 규칙의 근거(레퍼런스 축소 규칙)까지는 이 절에서 다루지 않는다 — 지금은 "가변 인자를 다른 함수로 그대로 넘길 때는 `std::forward`를 팩 전개에 씌운다"는 패턴만 손에 쥐면 된다.

## 실전 예제: 타입 안전 로거와 팩토리 함수

폴드 표현식과 완벽 전달을 합치면 이 절 서두의 문제(오버로드 지옥, `printf`의 타입 구멍)를 둘 다 해결하는 실용적인 코드 두 개가 나온다.

```cpp title="robot_logger.cpp"
#include <iostream>
#include <sstream>
#include <string>

// 가변 개수의 필드를 "key=value key=value ..." 한 줄로 만든다.
// 재귀도, 매크로도, printf 포맷 문자열도 없다 — 폴드 표현식 한 줄로 전개된다.
template <typename... Args>
std::string make_log_line(const Args&... fields) {
    static_assert(sizeof...(Args) >= 1, "필드는 최소 1개 필요");
    std::ostringstream oss;
    ((oss << fields << " "), ...);
    return oss.str();
}

struct Field {
    const char* key;
    double value;
};

std::ostream& operator<<(std::ostream& os, const Field& f) {
    return os << f.key << "=" << f.value;
}

int main() {
    std::cout << make_log_line(Field{"leg_id", 3}, Field{"angle", 47.5}, Field{"torque", 1.2}) << "\n";
}
```

```console
$ g++ -std=c++20 -Wall -Wextra robot_logger.cpp -o robot_logger
$ ./robot_logger
leg_id=3 angle=47.5 torque=1.2
```

각 필드는 `operator<<`가 정의된 진짜 타입(`Field`)으로 넘어간다. `printf_trap.cpp`처럼 포맷 지정자와 인자 타입이 어긋날 여지 자체가 없다 — 어긋나면 `operator<<` 오버로드 해석이 실패해 **컴파일이 그 자리에서 멈춘다.** 그리고 `static_assert(sizeof...(Args) >= 1, ...)`가 필드 없이 호출하는 실수를 컴파일 타임에 잡는다.

```console
$ g++ -std=c++20 -Wall -Wextra -c robot_logger_zero.cpp   # make_log_line() 인자 없이 호출
robot_logger_zero.cpp: In instantiation of 'std::string make_log_line(const Args& ...) [with Args = {}; ...]':
robot_logger_zero.cpp:14:31:   required from here
robot_logger_zero.cpp:7:35: error: static assertion failed: 필드는 최소 1개 필요
```

두 번째는 [2.9 unique_ptr](#/unique-ptr)의 소유권 이전을 가변 인자 팩토리로 감싸는 패턴이다. 생성자 인자 개수가 클래스마다 다르므로 파라미터 팩과 완벽 전달이 그대로 필요하다.

```cpp title="factory.cpp"
#include <iostream>
#include <memory>
#include <utility>

class LegController {
public:
    LegController(int leg_id, double init_angle)
        : leg_id_(leg_id), angle_(init_angle) {
        std::cout << "다리 " << leg_id_ << " 컨트롤러 생성, 초기 각도 " << angle_ << "\n";
    }

private:
    int leg_id_;
    double angle_;
};

// make_unique를 흉내 낸 팩토리 — 가변 인자를 생성자로 그대로 전달한다
template <typename T, typename... Args>
std::unique_ptr<T> make_leg(Args&&... args) {
    return std::make_unique<T>(std::forward<Args>(args)...);
}

int main() {
    auto leg = make_leg<LegController>(3, 47.5);
    (void)leg;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra factory.cpp -o factory
$ ./factory
다리 3 컨트롤러 생성, 초기 각도 47.5
```

`make_leg<LegController>(3, 47.5)`는 `int`와 `double`을 각각 값 범주를 유지한 채로 `LegController`의 생성자에 전달한다. 이 함수가 인자 개수·타입에 상관없이 그대로 동작하는 건, `Args...`가 정확히 `LegController`의 생성자 시그니처를 그대로 흉내 내기 때문이다 — 이게 다음 절에서 바로 확인할 `std::make_unique` 자체의 정체이기도 하다.

## 로보틱스 도메인: make_unique의 정체, printf 스타일 로깅의 함정

이 절에서 쓴 패턴이 라이브러리 코드 어딘가 먼 곳의 이야기가 아니라는 것을 확인한다. `/usr/include/c++/13/bits/unique_ptr.h`(GCC 13.3, libstdc++)를 직접 열어 보면 `std::make_unique`의 실제 정의가 이렇다.

```cpp title="libstdc++ bits/unique_ptr.h 발췌"
template<typename _Tp, typename... _Args>
  inline __detail::__unique_ptr_t<_Tp>
  make_unique(_Args&&... __args)
  { return unique_ptr<_Tp>(new _Tp(std::forward<_Args>(__args)...)); }
```

`factory.cpp`의 `make_leg`와 구조가 사실상 동일하다 — 파라미터 팩으로 임의 개수의 생성자 인자를 받고, `std::forward`로 값 범주를 유지한 채 `new _Tp(...)`에 넘긴다. `std::make_unique`, `std::make_shared`, `std::vector::emplace_back` 모두 "생성자에 뭘 넘길지는 모르지만 그대로 전달은 해야 한다"는 같은 문제를 이 절의 패턴으로 푼다. [2.9](#/unique-ptr), [2.10](#/shared-ptr)에서 이 함수들을 쓸 때 "왜 인자 개수 제한이 없는가"의 답이 여기 있었던 셈이다.

두 번째 연결은 로깅 그 자체다. Part X에서 다룰 rclcpp의 `RCLCPP_INFO`, `RCLCPP_WARN` 계열 매크로는 지금도 `printf` 스타일 포맷 문자열(`"leg %d ready at %.2f"`)을 받는다 — 서두에서 실측한 `%d`/`double` 함정이 실제 로봇 코드의 로그 한 줄에서 그대로 재현될 수 있다는 뜻이다. `robot_logger.cpp`처럼 파라미터 팩과 폴드 표현식으로 짠 로깅 유틸리티는 이 함정을 만들지 않는다 — 타입이 안 맞으면 `operator<<` 오버로드 해석이 실패해 컴파일이 멈추지, 런타임에 쓰레기 값을 찍지 않는다.

::: interview "가변 인자 템플릿과 폴드 표현식을 설명해 보라"
"인자를 여러 개 받는 템플릿"이라는 답만으로는 부족하다. 뼈대는 이렇다. ① 파라미터 팩(`typename... Args`)은 C의 `...`와 달리 **각 인자의 실제 타입을 인스턴스화 시점까지 그대로 유지**한다 — `printf`가 타입 정보를 버리는 것과 정반대다. ② C++11에서 팩을 순회하려면 헤드/테일 재귀와 빈 팩용 종료 조건 오버로드가 한 쌍으로 필요했다. ③ C++17 폴드 표현식(`(args op ...)`, `(... op args)`)은 이 재귀 쌍을 표현식 하나로 대체한다 — 좌측/우측 폴드가 비가환 연산에서 결합 순서를 다르게 만든다는 것도 같이 짚으면 실제로 써 봤다는 신호가 된다. ④ 팩을 다른 함수로 그대로 넘길 때는 `std::forward<Args>(args)...`(완벽 전달)를 씌워야 값 범주가 안 뭉개진다 — `std::make_unique`가 임의 개수의 생성자 인자를 받을 수 있는 것도 같은 답으로 설명된다.
:::

## 요약

- C의 `...`(가변 인자)는 인자 개수 제한을 없애는 대신 타입 검사를 포기한다 — `%d`/`double` 어긋남이 경고만 내거나(`-Wall`), 경고 없이(`-w`) 쓰레기 값을 찍는 것으로 실측된다.
- 파라미터 팩(`typename... Args`)은 타입 정보를 인스턴스화 시점까지 유지한 채 임의 개수의 인자를 받는다. `sizeof...(Args)`(개수)와 `sizeof(Args)...`(타입별 크기 팩)는 다른 연산이다.
- C++11 스타일은 팩을 헤드/테일로 나눠 재귀 호출하고, 빈 팩을 받는 별도 오버로드로 재귀를 끝낸다. 이 오버로드를 빼먹으면 `no matching function for call` 에러가 재귀 인스턴스화 사슬과 함께 뜬다(실측).
- C++17 폴드 표현식(`(args op ...)`, `(... op args)`, 이항 폴드 `(args op ... op init)`)은 이 재귀 쌍을 표현식 하나로 접는다. 좌측/우측 폴드는 비가환 연산에서 실제로 다른 값을 낸다(뺄셈으로 `7`과 `3`이 실측으로 갈린다).
- 팩을 다른 함수로 그대로 전달할 때는 `std::forward<Args>(args)...`를 씌워야 원래의 값 범주가 유지된다. 안 씌우면 각 원소는 함수 안에서 이름 붙은 변수가 되어 항상 lvalue로 취급된다(실측).
- `std::make_unique`/`std::make_shared`는 이 절의 패턴(파라미터 팩 + 완벽 전달)으로 구현돼 있다 — libstdc++ 헤더에서 직접 확인된다.

::: quiz 연습문제
1~3번은 개념 문제, 4~5번은 **직접 코드를 만들고 컴파일해서 확인하는** 실습이다.

1. `log_recursive.cpp`에서 빈 파라미터 팩을 받는 `log_msg()` 오버로드를 지우면 어떤 에러가 나는가? 에러 메시지의 `recursively required from` 줄이 왜 여러 번 반복되는지 설명하라.

2. `sub_right(10, 5, 2)`와 `sub_left(10, 5, 2)`가 각각 `7`과 `3`을 내는 이유를, 폴드가 펼쳐지는 순서를 직접 괄호로 풀어써서 설명하라. 같은 팩을 덧셈 폴드로 바꾸면 좌측/우측 결과가 같아지는 이유는 무엇인가?

3. `sizeof...(Args)`와 `sizeof(Args)...`의 차이를 설명하라. 후자를 단독으로 `std::cout`에 출력하려고 하면 왜 컴파일이 안 되는가(힌트: 이항 폴드 없이 팩만 남으면 무슨 일이 나는가)?

4. (실습, 코드 작성형) `log_recursive.cpp`(재귀 버전)를 폴드 표현식 한 줄짜리 함수로 리팩터링하라. 리팩터링 전후로 `main()`의 호출부는 그대로 두고, 출력이 정확히 동일한지 확인하라. 성공 기준: `g++ -std=c++20 -Wall -Wextra -c 파일.cpp`가 경고 없이 통과하고, 재귀 버전과 폴드 버전의 실행 출력이 한 글자도 다르지 않다.

5. (실습, 코드 작성형) 아래 뼈대에 `sizeof...(Args)`를 이용한 `static_assert`를 추가해, 인자가 정확히 짝수 개일 때만 컴파일이 통과하도록 만들어라(키-값 쌍으로 로그를 남기는 함수라고 가정한다). 홀수 개로 호출했을 때 정확히 어떤 메시지가 뜨는지 확인하라.

   ```cpp title="quiz5_stub.cpp"
   template <typename... Args>
   void log_kv(const Args&... /*args*/) {
       // 여기에 static_assert를 추가하라 — 힌트: sizeof...(Args) % 2 == 0
   }

   int main() {
       log_kv("leg_id", 3, "angle", 47.5);  // 4개 -> 통과해야 한다
       // log_kv("leg_id", 3, "angle");     // 3개 -> 컴파일 에러가 나야 한다
   }
   ```
:::

::: answer 해설
1. `no matching function for call to 'log_msg()'`가 뜬다. 재귀가 `T = "leg"`, `3`, `"ready"`, `47.5` 순으로 한 겹씩 팩을 벗기다가 마지막에 `Rest = {}`(빈 팩)로 인자 0개짜리 `log_msg(rest...)` 호출이 남는데 받아 줄 오버로드가 없다. 각 재귀 단계가 이전 단계의 인스턴스화에서 요구된 것이므로 `recursively required from`이 깊이만큼 반복된다.
2. 우측 폴드(`args - ...`)는 `10 - (5 - 2) = 7`, 좌측 폴드(`... - args`)는 `(10 - 5) - 2 = 3`이다. 덧셈은 결합 법칙이 성립해 `(1+2)+3`과 `1+(2+3)`이 같으므로 좌/우 차이가 값에 드러나지 않는다 — 뺄셈·나눗셈처럼 결합 법칙이 깨지는 연산에서만 방향이 실제로 중요하다.
3. `sizeof...(Args)`는 팩의 원소 개수를 정수 하나로 돌려준다. `sizeof(Args)...`는 각 타입에 `sizeof`를 적용한 결과를 나열한 **또 다른 팩**이다 — 그 자체론 숫자 하나가 아니라 "크기 목록"이라, 폴드(`(sizeof(Args) + ... + 0)`)로 접지 않으면 `std::cout <<`에 넘길 값이 안 나온다. 팩을 폴드 없이 그대로 출력하려 하면 "팩은 확장 문맥에서만 쓸 수 있다"는 취지의 에러가 난다.
4. `log_recursive.cpp`의 두 함수(종료 조건 + 재귀 본체)를 지우고 `log_fold.cpp`의 `((std::cout << args << " "), ...)`로 교체한다. `main()`의 `log_msg("leg", 3, "ready", 47.5)` 호출은 그대로 두면, 두 버전 모두 `leg 3 ready 47.5`를 출력한다(실측).
5. `static_assert(sizeof...(Args) % 2 == 0, "키-값 쌍이어야 하므로 인자는 짝수 개");`를 추가하면 4개짜리 호출은 통과하고, 3개짜리 줄의 주석을 풀면 같은 문구의 `static assertion failed`가 인스턴스화 문맥과 함께 뜬다. `robot_logger_zero.cpp`에서 이미 본 것과 같은 종류의 에러다.
:::

지금 IDE 터미널에서 `fold_order.cpp`를 그대로 타이핑하고 `g++ -std=c++20 -Wall -Wextra fold_order.cpp -o fold_order && ./fold_order`로 좌/우 폴드가 실제로 다른 값을 내는 것을 네 눈으로 확인해라. 그다음 연습문제 4번(재귀 → 폴드 리팩터링)과 5번(짝수 개 static_assert)을 끝까지 손으로 돌려라. 기준 명령: `g++ -std=c++20 -Wall -Wextra 파일.cpp -o 파일 && ./파일`.

**다음 절**: [4.5 Concepts (C++20)](#/concepts) — `typename`으로 뭐든 받던 템플릿에 "이 타입이어야만 한다"는 제약을 타입 자체에 새기는 법을 본다.
