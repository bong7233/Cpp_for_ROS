# 1.9 헤더와 컴파일 단위

::: lead
[1.1](#/compile-model)의 심장 문장을 다시 꺼낸다 — "선언은 번역 단위의 벽을 넘기 위한 약속이고, 약속만 믿고 코드를 만드는 것이 컴파일러의 설계다." 파일 두 개가 같은 함수를 쓰고 싶을 때 선언을 손으로 두 번 쓰면, 어긋나는 순간 사고가 난다 — 어떤 어긋남은 링크 에러로 잡히지만, 어떤 어긋남은 **링크까지 통과하고 틀린 값을 뱉는다**. 이 절은 그 사고를 실측으로 재현한 뒤, C++의 해법인 헤더 파일의 규칙 전부 — 가드, 자기 완결, 전방 선언, 순환 끊기 — 를 세운다. 헤더는 관습이 아니라 컴파일 모델이 강제하는 필연이다.
:::

## 손으로 쓴 선언은 시한폭탄이다

번역 단위는 서로를 못 보니, `main.cpp`가 `sensor.cpp`의 함수를 부르려면 선언이 필요하다. 가장 단순한 방법은 `main.cpp`에 직접 타이핑하는 것이고, 컴파일러는 그걸로 만족한다. 문제는 **선언을 정확히 기억해서 옮겨 적는 일을 사람이 한다**는 데 있다. 반환 타입 하나를 잘못 기억하면 무슨 일이 일어나는지 실측한다.

```cpp title="sensor.cpp"
// 시리얼 번호는 32비트를 넘는다
long sensor_serial() {
    return 0x1'0000'002AL;   // 4294967338
}
```

```cpp title="main.cpp — 선언을 손으로 다시 썼고, 틀렸다"
#include <iostream>

int sensor_serial();   // ❌ 정의는 long을 반환한다

int main() {
    std::cout << sensor_serial() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c sensor.cpp main.cpp
$ g++ main.o sensor.o -o serial
$ ./serial
42
```

컴파일 경고 0개, 링크 성공, 실행도 된다. 4294967338이 나와야 할 자리에 **42**가 나왔다. 왜 뚫리는지는 [1.1](#/compile-model)의 도구로 직접 확인할 수 있다.

```console
$ nm sensor.o main.o | grep sensor_serial
0000000000000000 T _Z13sensor_serialv
                 U _Z13sensor_serialv
```

맹글링된 심볼 `_Z13sensor_serialv`에는 함수 이름과 **인자 타입**(`v` = 인자 없음)만 들어가고 **반환 타입은 들어가지 않는다**. 그래서 `int sensor_serial()`을 믿고 만든 `U`와 `long sensor_serial()`이 제공하는 `T`가 같은 이름으로 짝지어진다. 링커는 이름만 맞추는 장부 담당자다 — 주고받는 비트 폭의 어긋남은 시야 밖이다. x86-64에서 int 반환값은 `rax`의 하위 32비트(`eax`)로 읽히므로 윗부분이 잘려 42가 됐다.

::: danger 이것은 미정의 동작이다
선언과 정의의 타입이 다른 프로그램은 미정의 동작(UB)이다. 이 환경(g++ 13.3, x86-64)에서는 하위 32비트 잘림으로 42가 나왔지만 **아무 보장이 없다** — 타입 조합에 따라 아예 다른 레지스터를 읽어 쓰레기 값이 나온다. 최악의 성질은 "동작하는 것처럼 보인다"는 것이다. 조인트 각도를 반환하는 함수가 몇 주를 버티다 값이 커지는 순간에만 틀리기 시작하는 — 그런 부류의 버그다.
:::

인자 타입이 어긋나면? 그쪽은 맹글링이 잡아 준다.

```cpp title="driver.cpp / main.cpp — 이번엔 인자 타입이 어긋났다"
// driver.cpp
int clamp_pwm(long v);           // 정의는 long을 받는다 (몸체 생략)

// main.cpp
int clamp_pwm(int v);            // ❌ 손으로 쓴 선언은 int
```

```console
$ g++ -std=c++20 -Wall -Wextra -c driver.cpp main.cpp
$ nm driver.o main.o | grep clamp
0000000000000000 T _Z9clamp_pwml
                 U _Z9clamp_pwmi
$ g++ main.o driver.o -o pwm
/usr/bin/ld: main.o: in function `main':
main.cpp:(.text+0xe): undefined reference to `clamp_pwm(int)'
collect2: error: ld returned 1 exit status
```

`_Z9clamp_pwmi`와 `_Z9clamp_pwml` — 인자 타입은 심볼에 새겨지므로 남남이 되고, 링크가 깨진다. 손으로 쓴 선언의 어긋남은 두 갈래다. **인자가 어긋나면 링크 에러(시끄러운 실패), 반환 타입이 어긋나면 UB(조용한 실패).** 어느 쪽도 컴파일러는 못 잡는다 — 각 번역 단위 안에서는 선언과 사용이 일관되기 때문이다.

근본 원인은 타입 하나가 아니라 **같은 정보의 사본이 두 곳에 있다**는 구조다. 사본은 언젠가 어긋난다. 처방은 사본을 없애는 것이다.

## 헤더: 선언의 단일 진실 공급원

선언을 파일 하나에 **한 번만** 쓰고, 필요한 모든 번역 단위가 그 파일을 `#include`한다. 이것이 헤더 파일의 전부다. `#include`는 복사-붙여넣기이므로 모든 번역 단위가 **글자 그대로 같은 선언**을 받고, 어긋날 사본 자체가 사라진다. 헤더가 선언의 **단일 진실 공급원(single source of truth)**이라는 말의 뜻이다. 로봇 수학 유틸리티로 전 과정을 돌린다.

```cpp title="robot_math.hpp — 선언(약속)만 둔다"
#pragma once

// 각도 유틸리티 — 정의는 robot_math.cpp에
double deg2rad(double deg);
double wrap_pi(double rad);
```

```cpp title="robot_math.cpp — 정의(이행)를 둔다"
#include "robot_math.hpp"   // 자기 헤더를 가장 먼저 include한다

#include <cmath>

double deg2rad(double deg) {
    return deg * M_PI / 180.0;
}

// 각도를 (-pi, pi] 범위로 정규화한다 — 누적 회전에서 필수
double wrap_pi(double rad) {
    rad = std::fmod(rad + M_PI, 2.0 * M_PI);
    if (rad <= 0.0) rad += 2.0 * M_PI;
    return rad - M_PI;
}
```

```cpp title="main.cpp — 손으로 쓰는 선언은 없다"
#include <iostream>

#include "robot_math.hpp"

int main() {
    std::cout << deg2rad(90.0) << "\n";
    std::cout << wrap_pi(deg2rad(370.0)) << "\n";   // 370도 == 10도
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c robot_math.cpp main.cpp
$ nm -C robot_math.o main.o | grep -E 'deg2rad|wrap_pi'
0000000000000000 T deg2rad(double)
000000000000002c T wrap_pi(double)
                 U deg2rad(double)
                 U wrap_pi(double)
$ g++ main.o robot_math.o -o robot_math && ./robot_math
1.5708
0.174533
```

`robot_math.o`가 `T`를 들고, `main.o`가 같은 심볼의 `U`를 들고, 링크에서 짝지어진다 — 1.1의 그림 그대로다. 달라진 것은 하나다. `U`를 만든 선언과 `T`를 만든 선언이 **물리적으로 같은 파일**에서 왔다.

### robot_math.cpp가 자기 헤더를 include하는 이유

`robot_math.cpp`의 첫 줄은 자기 헤더다. 정의하는 쪽은 선언이 필요 없는데 왜 include하는가. **컴파일러에게 선언과 정의를 나란히 보여줘서 어긋남을 잡게 하기 위해서다.** 정의의 반환 타입을 잘못 쓴 경우를 실측한다.

```console
$ g++ -std=c++20 -Wall -Wextra -c robot_math.cpp
robot_math.cpp:5:7: error: ambiguating new declaration of 'float deg2rad(double)'
    5 | float deg2rad(double deg) {          // 반환 타입을 잘못 썼다
      |       ^~~~~~~
In file included from robot_math.cpp:1:
robot_math.hpp:4:8: note: old declaration 'double deg2rad(double)'
```

첫 실험에서 링크를 뚫고 42를 찍었던 바로 그 부류의 어긋남이, 여기서는 **컴파일 에러**로 잡혔다. 같은 번역 단위 안에 헤더의 선언(`double` 반환)과 소스의 정의(`float` 반환)가 공존하니 컴파일러가 모순을 볼 수 있는 것이다. "자기 헤더를 첫 줄에 include하라"는 관습은 취향이 아니라 이 검증을 공짜로 얻는 장치다.

### 무엇이 헤더에 가고, 무엇이 소스에 가는가

| 헤더(.hpp)에 두는 것 | 소스(.cpp)에 두는 것 |
| --- | --- |
| 함수 **선언** (프로토타입) | 함수 **정의** (몸체) |
| 클래스/구조체/enum **정의** ([1.8](#/structs-enums)의 타입들) | 멤버 함수의 몸체 (클래스 밖 정의) |
| `inline` 함수/변수의 정의 | 전역 변수의 정의 |
| 템플릿의 정의 (전문) | 그 파일만 쓰는 내부 헬퍼 |
| `constexpr` 상수, 타입 별칭 | |

기준은 하나다. **"이것을 include한 모든 번역 단위에 복사돼도 되는가?"** 함수 정의가 헤더에 있으면 include한 번역 단위마다 `T`가 생기고, 링크에서 `multiple definition` — 하나의 정의 규칙(ODR) 위반으로 죽는다. 선언은 몇 번 복사돼도 `U` 하나로 수렴하므로 무해하다. 표에 예외처럼 보이는 줄이 셋 있다: 타입 정의는 정의인데도 헤더에 가고(모든 번역 단위가 레이아웃을 알아야 하고, 내용이 같으면 ODR이 허용한다), `inline` 정의는 중복을 링커가 하나로 접어 주고, 템플릿은 아예 정의 전체가 헤더에 있어야 한다. 정확한 규칙은 [1.10](#/linkage)과 [4.1 함수 템플릿](#/function-templates)에서 연다 — 지금은 표의 배치만 기억하면 된다.

## 두 번 붙여넣으면 두 번 정의된다 — 헤더 가드

[1.1](#/compile-model) 끝에서 예고한 문제를 재현할 차례다. 타입 정의는 헤더에 간다고 했다. 그런데 include는 무지성 붙여넣기다 — 같은 헤더가 한 번역 단위에 **두 경로로** 들어오면?

```cpp title="imu_types.hpp — 가드 없음 (일부러)"
struct ImuSample {
    double accel[3];
    double gyro[3];
    long   stamp_ns;
};
```

```cpp title="imu_filter.hpp"
#include "imu_types.hpp"

ImuSample low_pass(const ImuSample& prev, const ImuSample& now, double alpha);
```

```cpp title="main.cpp"
#include "imu_types.hpp"    // 직접 쓰니까 include했다 — 잘못이 아니다
#include "imu_filter.hpp"   // 이 안에서 imu_types.hpp가 한 번 더 붙는다

int main() {
    ImuSample s{};
    (void)s;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c main.cpp
In file included from imu_filter.hpp:1,
                 from main.cpp:2:
imu_types.hpp:2:8: error: redefinition of 'struct ImuSample'
    2 | struct ImuSample {
      |        ^~~~~~~~~
In file included from main.cpp:1:
imu_types.hpp:2:8: note: previous definition of 'struct ImuSample'
```

전처리가 끝난 번역 단위에는 `struct ImuSample`의 정의가 글자 그대로 두 번 들어 있고, 컴파일러는 재정의로 거절한다. **main.cpp에는 잘못이 없다.** `ImuSample`을 직접 쓰니 `imu_types.hpp`를, `low_pass`를 쓰니 `imu_filter.hpp`를 include했다 — 둘 다 옳은 행동이다. 헤더가 많아지면 이런 겹침은 회피 가능한 사고가 아니라 **정상 상태**다. 그래서 모든 헤더는 "한 번역 단위에 몇 번 붙여넣기당해도 한 번만 유효하게" 스스로를 방어해야 하고, 그 장치가 **헤더 가드(header guard)**다.

이 책의 기준은 `#pragma once`다. 헤더 첫 줄에 놓으면 전처리기가 "이 파일은 번역 단위당 한 번만 붙여넣는다"를 보장한다. `imu_types.hpp` 첫 줄에 추가하고 다시 컴파일하면 에러가 사라지고, `g++ -E`로 보면 구조체 정의가 한 번만 들어 있다(실측: 가드 전 2회 → 가드 후 1회).

고전적 방식은 매크로 가드다 — 결과는 같고 메커니즘이 다르다.

```cpp title="매크로 가드 — 같은 효과, 수동 관리"
#ifndef ROBOT_MATH_HPP_
#define ROBOT_MATH_HPP_
// ... 헤더 내용 ...
#endif  // ROBOT_MATH_HPP_
```

첫 include에서 `ROBOT_MATH_HPP_`가 정의되고, 두 번째 붙여넣기부터는 `#ifndef`가 거짓이라 내용 전체가 전처리에서 증발한다. 동작은 완벽하지만 **매크로 이름을 사람이 관리한다**는 약점이 있다 — 파일을 복사해 새 헤더를 만들면서 가드 이름을 안 바꾸면, 두 번째 헤더가 통째로 증발한다(에러조차 없다 — `#ifndef`는 자기 일을 정확히 했으니까). `#pragma once`는 파일 자체가 식별자라 이 사고가 원천적으로 없다. 이 책이 그걸 기본값으로 쓰는 이유다.

::: note ROS 2 코드에서는 매크로 가드를 읽게 된다
`#pragma once`는 표준 문서에 없는 확장이지만 GCC·Clang·MSVC 전부가 지원한다. 다만 ROS 2 생태계의 공식 스타일은 매크로 가드다 — `ament_cpplint`가 `MY_PKG__MOTOR_DRIVER_HPP_` 형식의 가드를 검사하고, rclcpp·Nav2 소스도 전부 그 형식이다. 방침: **자기 코드는 `#pragma once`, lint가 걸린 ROS 2 패키지에서는 그 규칙을 따른다.** 남의 생태계에서는 남의 규칙이 우선이다.
:::

::: deep #pragma once의 한계 하나
"파일 자체가 식별자"에도 가장자리가 있다. 같은 헤더가 파일시스템에 **두 벌 복사돼** 있으면(서드파티를 통째로 베끼는 vendoring에서 생긴다) `#pragma once`는 다른 파일로 취급해 둘 다 붙여넣고, 재정의 에러가 난다. 매크로 가드는 가드 이름이 같아 이 경우를 걸러 준다. 어느 쪽이 더 흔한 사고를 막는가의 선택이고, 복사본 두 벌보다 이름 관리 실수가 압도적으로 흔하다.
:::

::: interview "헤더 가드는 왜 필요한가? #pragma once와의 차이는?"
빌드 시스템 이해도를 재는 단골 질문이다. 뼈대: ① `#include`는 텍스트 복사이므로 같은 헤더가 한 번역 단위에 두 경로로 들어오는 일은 정상적으로 일어나고, 타입 정의가 두 번 붙으면 재정의 에러다. ② 가드는 "번역 단위당 한 번만 유효"를 보장한다 — `#ifndef` 3종은 매크로로, `#pragma once`는 파일 식별로 같은 일을 한다. ③ 차이: 전자는 표준이지만 이름을 사람이 관리하고 충돌 시 헤더가 조용히 증발한다. 후자는 비표준이지만 주요 컴파일러가 모두 지원하고 이름 관리가 없다. 여기에 "가드는 **한 번역 단위 안의** 중복만 막고, 번역 단위 사이의 중복 정의(ODR 위반)는 링커 차원의 다른 문제다"를 얹으면 두 층위를 구분한다는 신호가 된다.
:::

## 자기 완결 헤더 — include 순서에 기대지 마라

가드를 붙였다고 헤더가 완성된 게 아니다. 다음 헤더는 잘 동작하는 것처럼 **보인다**.

```cpp title="pose_log.hpp — 어딘가 빠졌다"
#pragma once

std::string pose_to_string(double x, double y, double theta);
```

`std::string`을 쓰면서 `<string>`을 include하지 않았다. 그런데 이 헤더를 쓰는 첫 번째 파일이 우연히 이렇게 생겼다면 —

```console
$ cat node_a.cpp
#include <string>          // 우연히 헤더보다 먼저 include했다
#include "pose_log.hpp"

int main() { return 0; }
$ g++ -std=c++20 -Wall -Wextra -c node_a.cpp && echo OK
OK
```

통과한다. 전처리 결과물에서 `<string>`의 내용이 헤더보다 먼저 붙었으니 컴파일러가 볼 때는 문제가 없다. 버그는 잠복해 있다가 **include 순서가 다른** 파일에서 터진다.

```console
$ cat node_b.cpp
#include "pose_log.hpp"    // 이 파일이 첫 include다

int main() { return 0; }
$ g++ -std=c++20 -Wall -Wextra -c node_b.cpp
In file included from node_b.cpp:1:
pose_log.hpp:4:6: error: 'string' in namespace 'std' does not name a type
    4 | std::string pose_to_string(double x, double y, double theta);
      |      ^~~~~~
pose_log.hpp:1:1: note: 'std::string' is defined in header '<string>';
did you forget to '#include <string>'?
```

같은 헤더인데 include한 파일에 따라 컴파일이 되기도, 안 되기도 한다. 이런 헤더는 사용자들에게 "나보다 먼저 `<string>`을 include해 놓으라"는, 어디에도 적혀 있지 않은 **암묵적 계약**을 강요한다. 규칙은 하나다. **헤더는 자기가 쓰는 모든 이름의 선언을 스스로 include한다.** 이 성질을 **자기 완결(self-contained)**이라 부른다. `pose_log.hpp`의 처방은 `#include <string>` 한 줄이다.

자기 완결성은 공짜로 검사할 수 있다 — "소스 파일은 자기 헤더를 **첫 줄에** include한다"는 관습이 그 검사다. 첫 include가 자기 헤더면 그보다 먼저 붙는 것이 없으므로, 자기 완결이 아닌 헤더는 그 자리에서 깨진다. 사고가 사용자 쪽 파일에서 무작위로 터지는 대신, 헤더 작성자의 책상에서 즉시 터진다.

방향이 하나 더 있다. 쓰는 것을 다 include하라는 규칙은, 뒤집으면 **쓰지 않는 것은 include하지 말라**다. 남이 include해 준 것에 무임승차하지도, 안 쓰는 것을 끌고 다니지도 않는 것 — 이 원칙을 IWYU(include what you use)라 부른다. 무임승차의 대가는 방금 실측했고, 과잉 include의 대가는 다음 섹션에서 잰다.

## 전방 선언 — 이름만 빌려 쓰기

헤더를 include하는 이유가 "그 타입의 이름이 존재한다" 하나뿐일 때가 있다. 그럴 때는 더 가벼운 도구가 있다.

```cpp title="fwd1.cpp — 포인터 멤버는 이름만으로 충분하다"
class MotorDriver;   // 전방 선언 — "이런 이름의 클래스가 있다"만 알린다

class LegController {
    MotorDriver* driver_;    // ✅ 포인터 멤버
public:
    explicit LegController(MotorDriver* d) : driver_(d) {}
};
```

`class MotorDriver;` 한 줄이 **전방 선언(forward declaration)**이다. 존재만 약속하고 내용은 안 주는, 타입 버전의 프로토타입이다. 이 상태의 `MotorDriver`를 **불완전 타입(incomplete type)**이라 부른다. 크기도 멤버도 모르는 타입으로 뭘 할 수 있는가? 포인터와 참조다. 포인터는 대상이 뭐든 8바이트(x86-64)라 `LegController`의 레이아웃을 정하는 데 `MotorDriver`의 내용이 필요 없다. 위 코드는 `MotorDriver`의 정의 없이 컴파일된다(실측, 경고 0개).

내용이 필요한 순간 컴파일러는 정확하게 거절한다.

```console
$ g++ -std=c++20 -Wall -Wextra -c fwd2.cpp    # MotorDriver driver_; (값 멤버)
fwd2.cpp:4:17: error: field 'driver_' has incomplete type 'MotorDriver'
$ g++ -std=c++20 -Wall -Wextra -c fwd3.cpp    # sizeof(MotorDriver)
fwd3.cpp:4:12: error: invalid application of 'sizeof' to incomplete type 'MotorDriver'
```

값 멤버는 그 자리에 객체가 통째로 들어가므로 크기와 레이아웃이 필요하고, `sizeof`는 말할 것도 없다. 멤버 접근(`d->stop()`), 상속, 값 전달/값 반환의 호출 지점도 마찬가지다. 경계선은 명확하다 — **크기나 내용을 묻는 순간 정의가 필요하고, 이름만 쓰는 동안은 전방 선언으로 충분하다.**

헤더 작성의 우선순위가 선다: **전방 선언으로 충분하면 include하지 않는다.** 포인터·참조 멤버와 포인터·참조를 받는 함수 선언이 그렇다. 소스 파일은 어차피 멤버를 호출하므로 거기서 include한다. 이 습관의 대가를 재 보자.

::: perf include 한 줄의 비용 (g++ 13.3, -std=c++20, 실측)
빈 `main` 하나짜리 번역 단위에 표준 헤더를 얹으며 전처리 후 줄 수와 컴파일 시간을 쟀다(3회 대표값, 절대값은 기기마다 다르지만 배율이 요점이다).

| 번역 단위 | 전처리 후 줄 수 | `g++ -c` 시간 |
| --- | --- | --- |
| 빈 파일 | 7줄 | 0.017초 |
| `#include <string>` | 25,325줄 | 0.24초 |
| `#include <iostream>` | 36,584줄 | 0.33초 |
| `#include <regex>` | 70,890줄 | 0.65초 |

include 한 줄이 컴파일 시간을 **10~40배** 만들고, 이 비용은 그 헤더를 include하는 **모든 번역 단위마다** 다시 낸다. 헤더가 헤더를 include하는 연쇄 때문에 상위 헤더의 과잉 include 하나가 프로젝트 전체로 곱해진다 — 번역 단위 100개가 안 쓰는 `<regex>`를 물려받으면 클린 빌드마다 1분이 사라지는 셈이다. 전방 선언은 이 연쇄를 헤더 층에서 끊는 도구이기도 하다.
:::

## 순환 include — 서로가 서로를 부를 때

전방 선언이 유일한 탈출구인 상황이 있다. 몸통은 다리들을 소유하고, 다리는 자기 몸통을 알아야 한다 — 자연스러운 설계다. 순진하게 쓰면 이렇게 된다.

```cpp title="robot.hpp"
#pragma once
#include <vector>

#include "leg.hpp"

class Robot {
    std::vector<Leg> legs_;
public:
    void add_leg(const Leg& leg) { legs_.push_back(leg); }
};
```

```cpp title="leg.hpp — robot.hpp를 include한다. 순환 완성"
#pragma once
#include "robot.hpp"

class Leg {
    Robot* owner_;    // 다리는 자기 몸통을 알아야 한다
public:
    explicit Leg(Robot* owner) : owner_(owner) {}
};
```

```console
$ g++ -std=c++20 -Wall -Wextra -c main.cpp      # main.cpp는 robot.hpp를 include
In file included from robot.hpp:4,
                 from main.cpp:1:
leg.hpp:5:5: error: 'Robot' does not name a type
    5 |     Robot* owner_;    // 다리는 자기 몸통을 알아야 한다
      |     ^~~~~
```

무한 재귀로 죽지 않은 것은 `#pragma once` 덕이다 — 붙여넣기 순서를 따라가면 에러의 필연이 보인다. `main.cpp`가 `robot.hpp`를 연다(once 기록됨) → `robot.hpp`가 `leg.hpp`를 연다 → `leg.hpp`가 `robot.hpp`를 열려 하지만 **이미 열었으므로 무시된다** → 그래서 `leg.hpp` 본문이 붙는 시점에 `Robot`이라는 이름은 아직 등장하지 않았다. 가드는 무한 루프를 끊을 뿐 순환을 풀지는 못하고, 둘 중 한쪽은 반드시 상대의 이름 없이 컴파일되는 처지가 된다. 에러도 고약하다 — 첫 에러만 원인이고 나머지는 여파이며, 순환의 낌새는 `In file included from` 사슬에 같은 계열 헤더가 서로 물려 있는 모양으로 나타난다.

해법은 이미 손에 있다. `Leg`는 `Robot`을 포인터로만 쓴다 — 이름만 필요하고, 이름만 필요하면 전방 선언이다.

```cpp title="leg.hpp — 수정판"
#pragma once

class Robot;      // ✅ 전방 선언 — include를 끊는다

class Leg {
    Robot* owner_;
public:
    explicit Leg(Robot* owner) : owner_(owner) {}
};
```

이 버전은 컴파일된다(실측). 기준을 일반화하면: **소유하는 쪽(값으로 담는 쪽)이 include하고, 참조하는 쪽(포인터로 아는 쪽)이 전방 선언한다.** `Robot`은 `std::vector<Leg>`에 `Leg`를 값으로 담으므로 include를 유지하고, `Leg`는 포인터뿐이므로 전방 선언으로 내려간다. 두 클래스가 서로를 값으로 소유하는 설계라면 전방 선언으로도 못 푼다 — 크기가 서로를 포함해 무한이 되므로, 그건 include 문제가 아니라 설계 문제다.

::: hist 텍스트 붙여넣기의 세금, 그리고 모듈
헤더 가드, 자기 완결, include 순서, 순환 — 이 절의 문제 전부가 한 뿌리에서 나온다. "다른 파일의 선언을 가져온다"를 **의미적 import가 아니라 텍스트 복사로** 구현한 1970년대의 결정이다. C++20의 모듈(module)이 그 뿌리를 바꾼 기능이다 — `import robot_math;`는 텍스트를 붙여넣는 대신 컴파일된 인터페이스를 참조하므로, 가드도 순서 의존도 반복 파싱 비용도 원리적으로 사라진다. 그래도 이 책이 헤더 기준인 이유는 현장이다: ROS 2를 포함한 로보틱스 생태계 전체(rclcpp, Nav2, Eigen, PCL)가 헤더 기반이다. 모듈은 "언젠가 옮겨 갈 곳"으로 알아 두고, 헤더의 규율은 지금 몸에 새긴다.
:::

## ROS 2 패키지에서 이 절이 그대로 나온다

이 절의 규칙은 ROS 2 패키지 구조에 그대로 박제돼 있다. 표준 배치는 이렇다.

```text nolines
hexpider_control/
  include/
    hexpider_control/          <- package-name subdirectory (on purpose)
      leg_kinematics.hpp       <- public API: declarations
  src/
    leg_kinematics.cpp         <- definitions
    control_node.cpp
  CMakeLists.txt
  package.xml
```

`include/` 바로 아래에 헤더를 두지 않고 **패키지 이름 디렉터리를 한 겹 더** 두는 것이 규칙이다. 사용하는 쪽은 항상 `#include "hexpider_control/leg_kinematics.hpp"`처럼 패키지 이름을 붙여 쓰므로, 패키지 수십 개가 얹히는 워크스페이스에서 두 패키지가 `utils.hpp` 같은 흔한 이름을 각자 가져도 충돌하지 않는다. 다른 패키지의 헤더가 `#include`로 보이게 하는 탐색 경로 배선은 CMake 타겟의 일이다 — [7.1](#/cmake-basics)과 [10.10](#/ament-colcon)에서 잇는다.

비용 감각으로 다시 볼 것이 하나 더 있다. rclcpp 튜토리얼 첫 줄의 `#include "rclcpp/rclcpp.hpp"`는 **우산 헤더(umbrella header)**다 — 노드, 퍼블리셔, 서브스크립션, 타이머, 로깅까지 rclcpp 공개 API 전체를 include 연쇄로 끌어들이는 편의용 최상위 헤더. 작은 노드에서는 그 편의가 옳다. 하지만 `<regex>` 한 줄이 0.65초였던 것을 기억하라 — 우산은 정의상 "안 쓰는 것까지 전부"이고, 비용은 include하는 번역 단위마다 낸다. 패키지가 커져 헤더가 헤더를 include하기 시작하면, **자기 헤더에는 우산 대신 실제로 쓰는 개별 헤더(`rclcpp/node.hpp` 등)나 전방 선언을 쓰는** IWYU 규율이 클린 빌드 시간으로 되돌아온다.

## 요약

- 손으로 복사한 선언은 어긋난다. 인자 타입이 어긋나면 링크 에러(맹글링이 잡는다), **반환 타입이 어긋나면 링크까지 통과하는 UB**다 — 반환 타입은 심볼에 안 새겨진다(실측: `long`을 `int`로 선언하니 42).
- 헤더는 선언의 단일 진실 공급원이다. 배치 기준은 "모든 번역 단위에 복사돼도 되는가" — 선언·타입 정의·inline·템플릿은 헤더로, 함수 정의는 소스로.
- 소스 파일은 **자기 헤더를 첫 줄에** include한다. 선언-정의 어긋남이 컴파일 에러로 잡히고(실측: `ambiguating new declaration`), 자기 완결성이 공짜로 검사된다.
- 같은 헤더가 두 경로로 들어오는 것은 정상 상태고, 가드 없으면 재정의 에러다. 이 책은 `#pragma once`, ROS 2 패키지에서는 그쪽 규칙(매크로 가드)을 따른다.
- 헤더는 자기가 쓰는 모든 것을 스스로 include한다(자기 완결). include 순서에 따라 깨지는 헤더는 암묵적 계약의 강요다.
- 이름만 필요하면(포인터·참조) include 대신 전방 선언. 크기·내용을 묻는 순간(값 멤버, `sizeof`, 멤버 호출) 완전한 타입이 필요하다. include 한 줄이 컴파일 시간 10~40배다(실측).
- 순환 include는 가드가 무한 루프만 막을 뿐 한쪽이 이름 없이 컴파일된다. 소유하는 쪽이 include, 참조하는 쪽이 전방 선언으로 끊는다.

::: quiz 연습문제
1~2번은 개념, 3~5번은 사고를 직접 재현하고 수리하는 실습이다.

1. 다음 각 항목을 `robot_math.hpp`와 `robot_math.cpp` 중 어디에 둘지 정하고 근거를 한 문장씩 대라. (a) `struct JointLimits { double min, max; };` (b) `double clamp_angle(double a, const JointLimits& lim);`의 몸체 (c) 그 함수의 프로토타입 (d) `clamp_angle`만 내부적으로 쓰는 헬퍼 함수 `normalize`.

2. A 팀원의 `imu.cpp`에는 `double read_temp();` 선언이, B 팀원의 `driver.cpp`에는 `float read_temp() { ... }` 정의가 있다. 빌드는 어느 단계까지 통과하고, 실행하면 어떻게 되는가? 인자가 `float read_temp(int ch)`로 다른 경우와 결과가 왜 다른지 심볼 수준에서 설명하라.

3. (실습) 순환 include 재현: 본문의 `robot.hpp`/`leg.hpp`(수정 전) 버전을 그대로 치고 `'Robot' does not name a type` 에러를 재현한 뒤, 전방 선언으로 끊어 컴파일을 통과시켜라. 마지막으로 `Leg`의 멤버를 `Robot* owner_`에서 `Robot owner_`(값)로 바꿔 보라. 성공 기준: 값 멤버 버전이 왜 전방 선언으로 못 풀리는지 에러 메시지를 근거로 설명할 수 있다.

4. (실습) 자기 완결성 검사: 아무 헤더(없으면 본문의 `pose_log.hpp`)에 대해, 그 헤더 **하나만** include하는 빈 `.cpp`를 만들어 `g++ -std=c++20 -Wall -Wextra -c`로 컴파일하라. 성공 기준: 통과하면 자기 완결이다. 실패하면 빠진 include를 헤더에(호출부가 아니라!) 추가해 통과시킨다.

5. (실습) 가드 증발 사고 재현: 매크로 가드를 쓴 헤더 `a.hpp`를 복사해 `b.hpp`를 만들되 **가드 이름을 안 바꾸고** 내용(구조체 이름)만 바꿔라. 두 헤더를 모두 include하는 `.cpp`를 컴파일하고 관찰하라. 성공 기준: include 시점엔 에러가 없는데 `b.hpp`의 타입을 쓰는 순간 에러가 나는 이유를 `g++ -E` 출력으로 증명한다.
:::

::: answer 해설
1. (a) 헤더 — 타입을 쓰는 모든 번역 단위가 레이아웃을 알아야 한다. (b) 소스 — 함수 정의가 헤더에 있으면 include한 번역 단위마다 `T`가 생겨 링크에서 `multiple definition`이다. (c) 헤더 — 선언이 바로 헤더의 존재 이유다. (d) 소스 — 외부에 약속할 필요가 없는 내부 구현은 노출하지 않는다([1.10](#/linkage)의 내부 링크리지로 숨긴다).
2. 컴파일·링크 모두 통과하고 실행된다 — 그리고 UB다. 인자 없는 함수의 심볼은 반환 타입과 무관하게 `_Z9read_tempv`로 같아서(실측) `U`와 `T`가 짝지어진다. 호출부는 `float`의 비트를 `double`로 읽게 되고, 어떤 값이 나오든 보장이 없다. 인자가 `(int)`로 다르면 심볼이 `_Z9read_tempi`가 되어 `U _Z9read_tempv`를 채울 `T`가 없고, `undefined reference`로 **링크에서** 잡힌다.
3. 값 멤버 버전은 `field 'owner_' has incomplete type 'Robot'`으로 죽는다. 전방 선언은 이름만 주고 크기를 안 주는데, 값 멤버는 `Leg` 안에 `Robot`이 통째로 들어가므로 크기가 필요하다. 게다가 이 설계는 서로가 서로를 값으로 담는 무한 포함이라, 도구가 아니라 설계를 고쳐야 한다(한쪽을 포인터로).
4. `pose_log.hpp`라면 `'string' in namespace 'std' does not name a type`이 나고, 헤더에 `#include <string>`을 추가하면 통과한다. 호출부에 추가해도 그 파일은 통과하지만 다음 사용자가 같은 지뢰를 밟는다 — 고치는 위치가 핵심이다.
5. 두 번째로 include된 헤더의 `#ifndef`가 거짓이 되어 내용 전체가 전처리에서 증발한다. include 시점에는 에러가 없다가 증발한 타입을 쓰는 순간에야 난다(g++ 13.3 실측: `'BetaConfig' was not declared in this scope`). `g++ -E`로 보면 `b.hpp` 자리가 비어 있는 것이 물증이다. 이 책이 `#pragma once`를 기본값으로 쓰는 이유를 네 손으로 확인한 것이다.
:::

이 절의 사고들은 네 IDE에서 직접 터뜨려 봐야 남는다. 최소한 첫 실험은 반드시 재현하라: `g++ -std=c++20 -Wall -Wextra -c sensor.cpp main.cpp && g++ main.o sensor.o -o serial && ./serial`로 42가 나오는 것을 본 다음, 선언을 헤더 공유 방식으로 고쳐 올바른 값이 나오는 것까지 확인하라. 경고 하나 없이 틀린 값이 나오는 광경은 글로 읽는 것과 직접 보는 것이 완전히 다르다.

**다음 절**: [1.10 네임스페이스와 링크리지](#/linkage) — 헤더가 "선언을 나눠 주는" 장치였다면, 이번엔 이름 자체의 규칙이다. 같은 심볼의 `T`가 두 개면 왜 죽는가(ODR), `static`과 `inline`이 그 규칙을 어떻게 바꾸는가.
