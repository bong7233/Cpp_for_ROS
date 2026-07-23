# 1.10 네임스페이스와 링크리지

::: lead
[1.1](#/compile-model)에서 링크는 "모든 `U`를 정확히 하나의 `T`와 짝짓는 일"이라고 정의했다. 그 문장에는 실패가 두 방향으로 예고돼 있었다. `T`가 없으면 `undefined reference` — 그건 이미 해부했다. 이 절은 나머지 하나, **같은 이름의 `T`가 두 개인 실패**에서 시작한다. C++은 이름을 어떻게 나눠 갖는가(네임스페이스), 이름 하나가 프로그램 어디까지 보이는가(링크리지), "정의는 하나"라는 규칙(ODR)은 정확히 무엇을 요구하는가. 이름에 관한 한, Part I의 마지막 절인 여기서 전부 끝낸다.
:::

## 같은 이름의 T가 두 개 오면

로봇에 라이다를 두 대 단다 — 전면은 A사, 후면은 B사. 각 벤더의 드라이버 코드를 프로젝트에 넣었는데, 두 벤더가 우연히 같은 함수 이름을 골랐다.

```cpp title="lidar_a.cpp"
// A사 라이다 SDK가 제공하는 초기화 함수
int init_sensor() { return 100; }
```

```cpp title="lidar_b.cpp"
// B사 라이다 SDK가 제공하는 초기화 함수
int init_sensor() { return 200; }
```

컴파일은 각자 멀쩡히 통과한다 — 번역 단위는 서로를 못 보니까([1.1](#/compile-model)) 각 파일 안에서는 문제가 없다. 사고는 링크에서 터진다.

```console
$ g++ -std=c++20 -Wall -Wextra -c lidar_a.cpp lidar_b.cpp main.cpp
$ g++ main.o lidar_a.o lidar_b.o -o robot
/usr/bin/ld: lidar_b.o: in function `init_sensor()':
lidar_b.cpp:(.text+0x0): multiple definition of `init_sensor()'; lidar_a.o:lidar_a.cpp:(.text+0x0): first defined here
collect2: error: ld returned 1 exit status
```

(이 절의 모든 출력은 g++ 13.3 / Ubuntu 24.04 x86-64 실측이다. 심볼의 주소값은 빌드마다 다르다.)

`nm`으로 두 오브젝트 파일을 열면 원인이 그대로 보인다. 둘 다 `T _Z11init_sensorv` — **같은 문자열의 심볼을 각자 "내가 갖고 있다"고 주장한다.** 링커에게 심볼은 이름 문자열이 전부다. 어느 파일에서 왔는지는 구분 기준이 아니다. `U`를 채울 후보가 둘이면 링커는 아무거나 고르지 않고 에러를 내고 멈춘다 — 100이 맞는지 200이 맞는지는 링커가 판단할 문제가 아니기 때문이다.

문제의 본질: **A사와 B사는 서로의 존재를 모른다.** 전 세계의 라이브러리 작성자가 이름을 겹치지 않게 조율하는 것은 불가능하다. C에는 언어 차원의 답이 없어서, 지금도 C 라이브러리들은 모든 공개 함수에 `sqlite3_`, `png_` 같은 접두사를 손으로 붙인다. C++의 답이 네임스페이스다.

## 네임스페이스: 이름의 성씨

네임스페이스(namespace)는 이름이 소속되는 영역이다. 같은 "철수"라도 김씨네 철수와 박씨네 철수는 다른 사람인 것처럼, 네임스페이스로 감싼 이름은 성씨가 붙은 완전한 이름(fully qualified name)으로 구분된다.

```cpp title="lidar_a.cpp — 네임스페이스로 감싼 버전"
namespace vendor_a {
int init_sensor() { return 100; }
}
```

```cpp title="lidar_b.cpp — 네임스페이스로 감싼 버전"
namespace vendor_b {
int init_sensor() { return 200; }
}
```

이게 링커 수준에서 무엇을 바꿨는지 `nm`으로 확인한다. [1.1](#/compile-model)에서 맹글링이 함수 이름에 인자 타입을 새기는 것을 봤다 — 네임스페이스도 같은 자리에 새겨진다.

```console
$ nm lidar_a.o lidar_b.o | grep init
0000000000000000 T _ZN8vendor_a11init_sensorEv
0000000000000000 T _ZN8vendor_b11init_sensorEv
$ nm -C lidar_a.o lidar_b.o | grep init
0000000000000000 T vendor_a::init_sensor()
0000000000000000 T vendor_b::init_sensor()
```

`_ZN8vendor_a...`와 `_ZN8vendor_b...` — 심볼 문자열 자체가 달라졌다. 링커에게 이 둘은 처음부터 남남이고, 충돌은 원천적으로 사라진다. 호출하는 쪽은 `vendor_a::init_sensor()`처럼 성씨까지 붙여 부른다. **네임스페이스는 컴파일러의 장부 정리 기능이 아니라, 맹글링을 통해 심볼 수준까지 내려가는 물리적 격리다.**

중첩도 되고, C++17부터는 `namespace hexpider::gait { ... }`처럼 한 줄로 쓴다. 이것도 심볼에 그대로 새겨진다(실측: `_ZN8hexpider4gait4planEv` → `hexpider::gait::plan()`). 긴 이름에는 별칭(namespace alias)을 만든다.

```cpp title="별칭 — 조각"
namespace fs = std::filesystem;          // 표준 라이브러리의 관례적 별칭
namespace hg = hexpider::gait;           // 프로젝트 안에서도 같은 문법
fs::path log_dir = "/var/log/hexpider";
```

### using 선언과 using 지시문 — 하나만 데려오기 vs 문을 열어젖히기

성씨를 매번 붙이기 번거로울 때 쓰는 도구가 둘 있는데, 위력이 전혀 다르다.

- **using 선언(using declaration)**: `using std::cout;` — 이름 **하나**를 현재 스코프로 데려온다.
- **using 지시문(using directive)**: `using namespace std;` — 그 네임스페이스의 **모든 이름**을 보이게 한다.

using 지시문을 **헤더에 쓰는 것은 금지**다. 이유를 실측으로 보인다. 팀원이 편의용 공통 헤더에 이렇게 써 뒀다고 하자.

```cpp title="util.hpp — ❌ 헤더의 using 지시문"
#pragma once
#include <algorithm>
using namespace std;   // 이 헤더를 include하는 모든 파일이 감염된다
```

다른 파일이 이 헤더를 쓰면서, 자기 일에 충실한 전역 변수 하나를 만들었다.

```cpp title="telemetry.cpp"
#include "util.hpp"

int count = 0;   // 수신한 패킷 수

int main() {
    count += 1;
    return count;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c telemetry.cpp
telemetry.cpp: In function 'int main()':
telemetry.cpp:6:5: error: reference to 'count' is ambiguous
/usr/include/c++/13/bits/stl_algo.h:4072:5: note: 'template<class _IIter, class _Tp> constexpr typename std::iterator_traits< <template-parameter-1-1> >::difference_type std::count(_IIter, _IIter, const _Tp&)'
telemetry.cpp:3:5: note: 'int count'
    3 | int count = 0;   // 수신한 패킷 수
```

(후보 목록 일부 생략.) `<algorithm>`의 `std::count`가 using 지시문에 의해 전역에 풀렸고, 내 변수 `count`와 겹쳐 모호성 에러가 났다. 악질적인 부분은 **에러가 터지는 위치**다. 원인은 `util.hpp`의 한 줄인데, 에러는 그 헤더를 include한 남의 파일, 남의 변수에서 난다. 헤더는 include하는 모든 번역 단위에 텍스트로 붙여넣어지므로([1.1](#/compile-model)), 헤더의 using 지시문은 그 헤더를 쓰는 **모든 파일의 이름 공간을 오염시킨다.** 오늘 컴파일되던 코드가 내일 표준 라이브러리에 이름 하나 추가되면서 깨질 수도 있다는 뜻이다.

::: warn 허용선은 이렇게 긋는다
using 지시문 자체가 악은 아니다. 문제는 **범위**다. `.cpp`나 함수 스코프 안에서는 영향이 거기서 끝나므로 쓸 수 있다 — ROS 2 공식 예제들이 `.cpp` 안에서 `using namespace std::chrono_literals;`를 쓰고 `500ms` 리터럴을 쓰는 것이 이 허용선 안의 관례다. 헤더에서는 using 선언(`using std::cout;`)도 전역 스코프에는 넣지 마라 — 이름 하나라도 남의 번역 단위에 심는 것은 같다. 요약: **헤더에서는 항상 완전한 이름, .cpp에서는 편한 만큼.**
:::

### ADL 맛보기: 비한정 호출은 인자의 성씨도 뒤진다

네임스페이스에는 예외적인 문이 하나 있다. 한정 없이 `f(x)`로 부르면 컴파일러는 현재 스코프뿐 아니라 **인자 `x`의 타입이 속한 네임스페이스도** 후보로 뒤진다. 인자 의존 조회(ADL, argument-dependent lookup)다. `std::cout << "hi"`가 동작하는 이유가 이것이다 — `operator<<`는 `std` 안에 있지만 인자(`std::ostream`)가 `std` 소속이라 자동으로 찾아진다. 이걸 의식적으로 쓰는 대표 관용구가 swap이다.

```cpp title="swap 관용구 — 조각"
using std::swap;   // 폴백으로 std::swap을 후보에 올려 두고
swap(a, b);        // 비한정 호출 — a의 타입이 속한 네임스페이스에
                   // 전용 swap이 있으면 ADL이 그쪽을 고른다
```

실측: `hexpider::LegState`에 대해 `hexpider::swap`을 정의해 두면 위 호출은 `hexpider::swap`을 찾아간다. 타입 작성자가 전용 swap을 제공하면 그것이, 없으면 `std::swap`이 쓰이는 구조다. ADL의 전체 규칙은 깊지만 여기서는 이 관용구 하나만 가져가면 된다 — 연산자 오버로딩이 서 있는 기반이기도 하다([3.6](#/operator-overloading)에서 다시 만난다).

### ROS 2 코드의 네임스페이스 지형

이 지식은 Part X에서 매일 쓴다. rclcpp의 공개 API는 전부 `rclcpp::` 아래에 있고, 하위 영역은 `rclcpp::executors::MultiThreadedExecutor`처럼 중첩으로 갈라지며, 내부 구현은 `detail::`에 숨긴다("이 안은 부르지 마라"는 신호다). `tf2_ros::`, `sensor_msgs::msg::` — 패키지가 곧 성씨다. 당신의 프로젝트도 같다: Hexpider의 모든 코드는 `hexpider::` 아래, 보행 계획은 `hexpider::gait`, 다리 기구학은 `hexpider::kinematics` 식으로 — 어떤 라이브러리를 가져다 써도 이름이 충돌하지 않는 것이 이 한 겹의 값어치다.

## ODR: 무엇이 "하나"여야 하는가

이 절의 이론적 중심으로 간다. 도입부의 `multiple definition` 에러 뒤에 있는 규칙이 **하나의 정의 규칙(ODR, One Definition Rule)**이다.

- **선언은 몇 번이든 된다.** `int add(int, int);`를 백 번 선언해도 합법이다 — 선언은 약속이지 실체가 아니다.
- **함수와 변수의 정의는 프로그램 전체에 정확히 하나여야 한다.** 정의는 심볼 테이블에 `T`(또는 데이터 영역의 `D`)를 만들고, 같은 이름의 `T`가 둘이면 링커가 거부한다.

[1.9](#/headers)의 규칙 — "헤더에는 선언, .cpp에는 정의" — 을 어기면 무슨 일이 나는지 실측으로 본다. 각도 변환 함수를 헤더에 **정의**째로 넣었다.

```cpp title="angle.hpp — ❌ 헤더에 함수 정의"
#pragma once

double deg_to_rad(double deg) {
    return deg * 3.14159265358979323846 / 180.0;
}
```

이 헤더를 `leg.cpp`와 `body.cpp`가 include하면, 텍스트 붙여넣기에 의해 **두 번역 단위 모두에 정의가 복제된다.**

```console
$ g++ -std=c++20 -Wall -Wextra -c leg.cpp body.cpp
$ nm -C leg.o | grep deg_to_rad
0000000000000000 T deg_to_rad(double)
$ nm -C body.o | grep deg_to_rad
0000000000000000 T deg_to_rad(double)
$ g++ leg.o body.o -o hex
/usr/bin/ld: body.o: in function `deg_to_rad(double)':
body.cpp:(.text+0x0): multiple definition of `deg_to_rad(double)'; leg.o:leg.cpp:(.text+0x0): first defined here
collect2: error: ld returned 1 exit status
```

도입부의 라이다 충돌과 심볼 수준에서 같은 사고다. 차이는 원인뿐이다 — 이번엔 두 저자가 우연히 같은 이름을 쓴 게 아니라, **한 명이 쓴 하나의 정의가 include에 의해 기계적으로 복제됐다.** 헤더 가드는 이걸 못 막는다는 데 주의하라. 가드가 막는 것은 "한 번역 단위 안에서 두 번 붙여넣기"이고, 지금 문제는 "서로 다른 번역 단위에 한 번씩 붙여넣기"다.

### inline: "중복을 눈감아 달라"는 허가

[1.6](#/functions)에서 예고한 것을 심볼로 확인할 차례다. `inline` 한 단어를 붙이면 이 에러가 사라진다.

```cpp title="angle.hpp — ✅ inline"
#pragma once

inline double deg_to_rad(double deg) {
    return deg * 3.14159265358979323846 / 180.0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c leg.cpp body.cpp
$ nm -C leg.o | grep deg_to_rad
0000000000000000 W deg_to_rad(double)
$ nm -C body.o | grep deg_to_rad
0000000000000000 W deg_to_rad(double)
$ g++ leg.o body.o -o hex && nm -C hex | grep deg_to_rad
0000000000001144 W deg_to_rad(double)
```

심볼 종류가 `T`에서 **`W`(weak, 약한 심볼)**로 바뀌었다. `T`가 "이 정의는 유일해야 한다"는 주장이라면, `W`는 "다른 데도 있을 수 있다 — 겹치면 하나 골라 쓰라"는 표식이다. 링커는 `W`끼리는 충돌로 치지 않고 **하나만 남기고 접는다(fold).** 실행파일에 `deg_to_rad`가 한 벌만 남은 것이 그 증거다. 이것이 현대 C++에서 `inline`의 진짜 의미다: 속도 힌트가 아니라(그 오해는 1.6에서 부쉈다), **"이 정의는 여러 번역 단위에 나타나도 ODR 위반이 아니다"라는 링크 규칙의 완화.** 헤더에 정의를 두는 모든 것 — 헤더 온리 라이브러리, 템플릿, constexpr 함수 — 이 이 장치 위에 서 있다.

::: deep 접히는 건 공짜가 아니다 — 그리고 inline 변수
`W`로 접히는 대신 지불하는 것이 있다: 같은 함수가 번역 단위마다 **컴파일은 전부 된다.** 100개의 .cpp가 include하면 100번 컴파일되고 링크에서 99벌이 버려진다 — 헤더에 큰 함수를 넣으면 빌드가 부푸는 구조적 이유다. 한편 C++17부터는 변수에도 `inline`이 붙는다. `inline constexpr double kPi = 3.14159...;`를 헤더에 두면 프로그램 전체에서 한 개체로 접힌다 — 헤더에서 전역 상수를 공유하는 현대적 방법이다.
:::

### 클래스 정의는 왜 헤더에 있어도 되나

의문이 하나 남는다. [1.8](#/structs-enums)부터 구조체·클래스 정의는 아무렇지 않게 헤더에 넣어 왔다. `class Servo { ... };`가 열 개의 .cpp에 붙여넣어져도 링커는 조용했다. 왜인가.

**클래스 정의는 코드가 아니라 설계도이기 때문이다.** `class Servo { int angle_; };`라는 텍스트는 기계어를 한 바이트도 만들지 않는다 — 컴파일러가 이 타입의 크기와 멤버를 알게 될 뿐, 심볼 테이블에 아무것도 남지 않는다. 심볼이 없으니 충돌할 것도 없다. ODR이 타입 정의에 요구하는 것은 "프로그램에 하나"가 아니라 **"번역 단위마다 한 번씩, 단 모든 번역 단위에서 토큰까지 동일하게"**다. 같은 설계도를 다시 읽는 것은 허용하되, 설계도가 서로 달라선 안 된다.

단, 클래스 **안에서 정의한 멤버 함수**는 코드를 만든다. 그런데도 에러가 안 나는 이유는 실측하면 보인다.

```console
$ nm -C u1.o | grep Servo
0000000000000000 W Servo::set_angle(int)
0000000000000000 W Servo::angle() const
```

`W`다. **클래스 정의 안에 몸체를 쓴 멤버 함수는 자동으로 inline이다.** `inline`을 타이핑하지 않았어도 언어가 붙여 준다 — 안 그러면 클래스를 헤더에 두는 것 자체가 불가능해지기 때문이다.

::: danger 토큰이 다르면 에러 없이 침몰한다
"모든 번역 단위에서 동일" 조건이 깨지면 — 두 .cpp가 서로 다른 버전의 `Servo` 정의를 보게 되면(오래된 헤더 복사본, 조건부 컴파일 분기 차이) — 컴파일러도 링커도 **에러를 내 주지 않는다.** 번역 단위는 서로를 못 보고, 링커는 `W`를 아무거나 골라 접기 때문이다. 표준은 이를 진단 불요(no diagnostic required)의 미정의 동작으로 규정한다. 멤버 배치가 어긋난 두 코드가 한 객체를 만지며 조용히 메모리를 부순다 — 헤더를 복사해 두 벌 만들지 말아야 하는 진짜 이유다. UB는 [2.11](#/ub-sanitizers)에서 정면으로 다룬다.
:::

## 내부 링크리지: 이름을 번역 단위 안에 가둔다

지금까지의 이름들은 전부 **외부 링크리지(external linkage)**였다 — 심볼 테이블에 `T`/`D`로 올라가 다른 번역 단위가 참조할 수 있는 이름. 링크리지(linkage)란 이것이다: **어떤 이름이 다른 번역 단위에서 같은 개체를 가리킬 수 있는가의 속성.** 전역 함수·전역 변수는 기본이 외부 링크리지고, 그래서 도입부처럼 전 세계와 이름을 경합한다.

그런데 .cpp 안에만 쓰이는 헬퍼까지 전 세계에 광고할 이유가 없다. 이름을 번역 단위 안에 가두는 것이 **내부 링크리지(internal linkage)**이고, 도구는 **익명 네임스페이스(anonymous namespace)**다.

```cpp title="filt.cpp"
namespace {                      // 이름 없는 네임스페이스 — 이 파일 전용
double alpha = 0.2;
double smooth(double prev, double now) {
    return alpha * now + (1 - alpha) * prev;
}
}  // namespace

double filter_step(double prev, double now) {   // 이것만 공개 인터페이스
    return smooth(prev, now);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c filt.cpp
$ nm -C filt.o
0000000000000042 T filter_step(double, double)
0000000000000000 d (anonymous namespace)::alpha
0000000000000000 t (anonymous namespace)::smooth(double, double)
```

`smooth`가 대문자 `T`가 아니라 **소문자 `t`**다. `nm`에서 소문자는 로컬 심볼 — 이 오브젝트 파일 안에서만 유효하고, 링커의 전역 짝짓기 장부에 아예 올라가지 않는 이름이다. 실측: 다른 .cpp가 자기만의 `smooth`를(같은 시그니처, 다른 구현) 익명 네임스페이스에 갖고 있어도 두 파일은 충돌 없이 링크되고 각자 자기 것을 부른다. 네임스페이스가 "성씨로 구분한다"라면, 내부 링크리지는 "애초에 밖에 이름을 내놓지 않는다"다.

같은 효과를 내는 오래된 도구가 `static`이다. `static int helper() { ... }`도 실측하면 `t`가 된다. 뜻은 같지만 **이 책의 기준은 익명 네임스페이스다.**

::: hist 왜 static이 아니라 익명 네임스페이스인가
`static`은 C++에서 가장 과적재된 키워드다 — 파일 스코프에서는 내부 링크리지, 클래스 안에서는 "인스턴스 소속이 아님", 함수 안에서는 "수명이 함수를 넘는다"([2.1](#/memory-model)). 익명 네임스페이스는 그중 첫 번째 하나만을 뜻하고, `static`이 못 하는 것 — 타입(클래스·enum) 정의를 파일 안에 가두는 것 — 까지 된다. C 호환 경계가 아니라면 익명 네임스페이스로 통일하는 것이 현대 C++의 표준적 선택이다.
:::

::: tip .cpp의 헬퍼는 기본이 익명 네임스페이스다
습관으로 만들어라: 파일 전용 헬퍼·상수·타입은 전부 익명 네임스페이스 블록 안에 쓴다. 얻는 것이 셋이다 — ① 전역 이름 충돌의 원천 차단(수백 개 번역 단위가 링크되는 ROS 2 워크스페이스에서 실질적 가치가 있다), ② 파일의 공개 인터페이스가 코드 구조로 드러남, ③ 외부에서 안 보인다는 사실을 아는 컴파일러의 더 공격적인 최적화 여지.
:::

## 외부 링크리지와 extern

반대 방향 — 여러 번역 단위가 하나의 전역 변수를 **공유**하는 메커니즘도 심볼로 이해할 수 있다. 열쇠는 `extern`이다.

```cpp title="state.cpp"
int battery_mv = 12600;    // 정의 — 프로그램 전체에 이거 하나
```

```cpp title="monitor.cpp"
#include <iostream>

extern int battery_mv;     // 선언 — "정의는 다른 데 있다"

int main() {
    battery_mv -= 100;
    std::cout << battery_mv << "\n";
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c state.cpp monitor.cpp
$ nm state.o
0000000000000000 D battery_mv
$ nm monitor.o | grep battery
                 U battery_mv
$ g++ monitor.o state.o -o mon && ./mon
12500
```

익숙한 그림이다. `extern` 선언은 함수의 선언과 같은 역할을 한다 — 컴파일러에게 타입만 알려 주고, 오브젝트 파일에 `U`(외상)를 남기고, 링커가 `D`(데이터 영역의 정의)와 짝짓는다. 함수와 다른 점 하나: `extern` 없이 `int battery_mv = 12600;`을 두 파일에 쓰면 정의가 두 개가 되어 `multiple definition of 'battery_mv'`로 링크가 깨진다(실측). **`extern`은 "이건 정의가 아니라 선언"이라고 명시하는 표지다.**

메커니즘은 이렇게 단순하지만, **이 메커니즘을 쓰지 않는 것이 실력이다.** 공유 전역 변수는 "누가, 언제 바꿨는가"를 추적할 수 없는 상태다 — 어느 줄이든 용의자다. 제어 코드에서는 더 치명적이다: 센서 콜백 스레드와 제어 루프 스레드가 같은 전역을 만지는 순간 데이터 레이스라는 UB가 되고([6.2](#/data-races)), 바로 아래의 초기화 순서 문제까지 얹힌다. 공유가 필요하면 소유자를 정해 객체로 감싸고 참조로 전달하라 — Part II·III 전체가 그 방법론이다.

### extern "C": C 세계와의 국경

`extern`에는 전혀 다른 일을 하는 변종이 있다. 로봇 개발자는 이걸 피할 수 없다 — 모터 드라이버, CAN 인터페이스, 센서 벤더 SDK의 상당수가 **C API**로 제공되기 때문이다. C에는 오버로딩이 없고 맹글링도 없다. C 컴파일러가 만든 라이브러리 안의 심볼은 `dxl_open` 같은 평평한 이름인데, C++ 컴파일러는 그 함수의 선언을 보면 습관대로 `_Z8dxl_openi`를 찾는 `U`를 만들고, 링크는 실패한다. `extern "C"`가 이 국경을 잇는다: "이 선언들의 심볼은 C 방식으로 다뤄라."

```cpp title="cdrv.cpp — 맹글링 차이 실측용"
extern "C" int dxl_open(int port) { return port; }
int cpp_open(int port) { return port; }
```

```console
$ g++ -std=c++20 -Wall -Wextra -c cdrv.cpp && nm cdrv.o
0000000000000010 T _Z8cpp_openi
0000000000000000 T dxl_open
```

같은 파일 안에서 `extern "C"`가 붙은 쪽만 맹글링이 사라졌다. 잘 만든 C 라이브러리 헤더는 이 처리를 스스로 한다 — 파일 전체를 `#ifdef __cplusplus` / `extern "C" {` / `#endif`로 감싸는, C++ 컴파일러에게만 발동하는 관용구다. 벤더 SDK 헤더에 이 블록이 없다면 include하는 쪽에서 `extern "C" { #include "vendor.h" }`로 감싼다. 대가도 있다: 맹글링이 없으니 `extern "C"` 함수는 오버로딩이 안 된다.

## 초기화 순서: 링크 순서가 값을 바꾼다

전역 변수를 피하라는 이유 중 가장 기괴한 것으로 끝낸다. 전역 변수의 초기화가 상수가 아니라 **실행이 필요한 계산**이면(동적 초기화), 그 실행은 `main` 이전에 일어난다. 문제: **서로 다른 번역 단위에 있는 전역들의 초기화 순서를 표준은 정의하지 않는다.**

```cpp title="config.cpp"
int read_default_speed() { return 40; }      // 실제로는 파라미터 파일을 읽는다고 하자
int default_speed = read_default_speed();    // 동적 초기화
```

```cpp title="gait.cpp"
extern int default_speed;
int gait_speed = default_speed * 2;          // ❌ 다른 번역 단위의 전역을 읽는 초기화
```

`main`은 `gait_speed`를 출력만 한다. 오브젝트 파일 순서만 바꿔 두 번 링크한다.

```console
$ g++ main.o config.o gait.o -o walk1 && ./walk1
80
$ g++ main.o gait.o config.o -o walk2 && ./walk2
0
```

**같은 소스, 같은 컴파일러, 링크 순서만 다른데 결과가 80과 0이다.** 두 번째 빌드에서는 `gait.cpp`의 초기화가 먼저 돌았고, 그 시점의 `default_speed`는 아직 0(동적 초기화 전의 제로 초기화 상태)이었다. 이 함정의 이름이 **정적 초기화 순서 문제(static initialization order fiasco)**다. 이 실측에서 순서를 정한 것은 파일 나열 순서지만 그것조차 보장이 아니다 — 빌드 시스템이 파일 순서를 바꾸는 순간, 잘 돌던 로봇이 속도 0으로 기는 버그가 **코드 변경 없이** 생길 수 있다.

해결책은 "초기화 시점을 첫 사용 시점으로 미루는 것"이고, 함수 안의 static 지역 변수가 정확히 그 도구다.

```cpp title="config.cpp — ✅ 함수-로컬 static"
int read_default_speed() { return 40; }

int& default_speed() {
    static int value = read_default_speed();   // 이 줄은 첫 호출 순간에 실행된다
    return value;
}
```

`gait.cpp`는 `default_speed() * 2`로 바꾼다. 실측: 링크 순서를 어느 쪽으로 해도 80이다. static 지역 변수의 초기화는 **제어 흐름이 그 줄을 처음 지나는 순간**으로 정의돼 있어서, "쓰기 전에 초기화됐는가"라는 질문 자체가 성립하지 않는다. 전역으로 하나 있어야 하는 객체를 이 패턴으로 감싼 것이 마이어스 싱글턴(Meyers singleton) 관용구이고, C++11부터 이 초기화는 스레드 안전이다 — 여러 스레드가 동시에 첫 호출을 해도 정확히 한 번 초기화된다(비용과 함정은 Part VI에서).

::: interview "ODR이 뭔가", "inline의 진짜 의미는"
면접 단골 두 개를 이 절이 정면으로 커버한다. **ODR**: ① 선언은 무한, 정의는 프로그램 전체에 하나 — 위반하면 `multiple definition` 링크 에러. ② 단 클래스·템플릿·inline 함수는 예외로, 번역 단위마다 하나씩 있되 모든 번역 단위에서 토큰 단위로 동일해야 한다. ③ 동일 조건이 깨지면 진단 없는 UB — 컴파일러도 링커도 못 잡는다는 것까지 말하면 상급이다. **inline**: ① 최적화 힌트가 아니다 — 인라인 확장은 컴파일러가 스스로 결정한다. ② 실제 의미는 "이 정의의 중복을 ODR 위반으로 치지 마라"는 링크 규칙 완화이고, 심볼이 `T` 대신 약한 심볼 `W`로 나가 링커가 하나로 접는다. ③ 그래서 헤더 온리 라이브러리와 템플릿이 성립한다. `nm`으로 `T`/`W`/`t`를 직접 확인해 봤다고 말하면 도구를 열어 본 사람의 답이 된다.
:::

## 요약

- 링커에게 이름은 전역 유일해야 한다. 같은 심볼의 `T`가 둘이면 `multiple definition` — 네임스페이스는 이름을 맹글링에 새겨(`_ZN8vendor_a...`) 심볼 수준에서 격리한다.
- using 지시문을 헤더에 쓰지 마라 — include하는 모든 번역 단위를 오염시키고, 에러는 엉뚱한 파일에서 터진다(실측: 전역 `count`와 `std::count`의 모호성). .cpp·함수 스코프에서만 쓴다.
- ODR: 선언은 무한, 함수·변수의 정의는 프로그램에 하나. 헤더의 함수 정의는 include 횟수만큼 복제돼 링크가 깨진다 — `inline`이 중복을 합법화하고, 심볼은 `W`(약한 심볼)로 나가 링커가 하나로 접는다.
- 클래스 정의는 심볼을 만들지 않는 설계도라 번역 단위마다 있어도 된다(단 모두 동일해야 하며, 다르면 진단 없는 UB). 클래스 안에 정의한 멤버 함수는 자동 inline이다.
- .cpp 전용 헬퍼는 익명 네임스페이스에 가둬라 — 심볼이 로컬(`t`)이 되어 링커 장부에서 빠진다. `static`보다 익명 네임스페이스가 이 책의 기준이다.
- `extern`은 변수의 "선언"이다 — `U`를 남기고 링커가 정의(`D`)와 짝짓는다. 메커니즘은 알되 공유 전역 변수 자체를 피하라. `extern "C"`는 맹글링을 끄는 국경 장치 — C API 드라이버 SDK 링크에 필수다.
- 번역 단위 간 전역 동적 초기화는 순서 보장이 없다 — 링크 순서만 바꿔도 80이 0이 됐다(실측). 처방은 함수-로컬 static(첫 사용 시점 초기화, C++11부터 스레드 안전)이다.

::: quiz 연습문제
1~2번은 개념, 3~4번은 네 컴퓨터에서 심볼을 직접 확인하는 실습, 5번은 예측 훈련이다.

1. 두 오브젝트 파일에 `nm -C`를 댔더니 둘 다 `t (anonymous namespace)::clamp(double)`가 있다. 이 둘을 함께 링크하면 `multiple definition`이 나는가? 심볼 종류를 근거로 답하라.

2. 팀원이 "매번 `std::`를 치기 귀찮으니 공용 헤더에 `using namespace std;`를 넣자"고 한다. 반대 근거를 두 가지 대라 — 하나는 영향 범위 관점에서, 하나는 "에러가 터지는 위치" 관점에서.

3. (실습) `deg_to_rad` 사고를 처음부터 재현하라: ① 헤더에 함수를 정의하고 두 .cpp가 include하게 만든 뒤 `g++ -std=c++20 -Wall -Wextra -c a.cpp b.cpp && g++ a.o b.o -o app`로 `multiple definition`을 확인 ② `nm -C`로 두 .o 모두에서 `T`를 확인 ③ `inline`을 붙여 다시 빌드. 성공 기준: 링크가 통과하고, 심볼이 `T`에서 `W`로 바뀐 것을 네 눈으로 본다.

4. (실습) .cpp 하나에 공개 함수와 헬퍼 함수를 쓰고 `nm -C`로 둘 다 `T`인 것을 확인한 뒤, 헬퍼를 익명 네임스페이스로 감싸고 다시 확인하라. 성공 기준: 헬퍼만 소문자 `t`로 바뀌고, 컴파일·링크에 지장이 없다.

5. `config.cpp`의 전역 `int default_speed = read_default_speed();`와 `gait.cpp`의 전역 `int gait_speed = default_speed * 2;`를 `g++ main.o gait.o config.o` 순서로 링크했더니 `gait_speed`가 0이다. ① 왜 80이 아니라 0인지 초기화 단계로 설명하라. ② 함수-로컬 static으로 고친 버전은 왜 링크 순서와 무관하게 80인가.
:::

::: answer 해설
1. **나지 않는다.** 소문자 `t`는 로컬 심볼 — 내부 링크리지다. 링커의 전역 심볼 해소 장부에 올라가지 않으므로 다른 번역 단위의 같은 이름과 비교 자체가 일어나지 않는다. 충돌하는 것은 전역 심볼(`T`/`D`)뿐이다. 두 파일이 각자 다른 구현의 `smooth`를 갖고도 링크에 성공한 본문 실측이 이 경우다.
2. ① 영향 범위: 헤더는 include하는 모든 번역 단위에 붙여넣어지므로, 그 한 줄이 이 헤더를 쓰는 현재와 미래의 모든 파일에 `std`의 수천 개 이름을 풀어놓는다. 표준 라이브러리에 이름이 추가되는 순간 기존 코드가 깨질 수도 있다. ② 에러 위치: 충돌은 헤더가 아니라 그 헤더를 include한 남의 파일의, 겉보기에 무관한 이름에서 터진다(실측: `int count`가 `std::count`와 모호성 에러). 원인과 증상이 다른 파일에 있는 버그는 추적 비용이 가장 비싸다.
3. g++ 13.3 실측 기준: ①에서 `multiple definition of ...; first defined here`, ②에서 두 .o 모두 `T`, ③에서 둘 다 `W`로 바뀌며 링크가 통과한다. 실행파일에 `nm -C`를 대면 `W` 한 벌만 남아 있다 — 링커가 접었다는 물증이다.
4. 감싸기 전에는 둘 다 `T`, 감싼 후에는 헬퍼가 `t (anonymous namespace)::이름`이 된다. 공개 함수가 같은 파일 안에서 헬퍼를 부르는 것은 아무 문제가 없다 — 내부 링크리지는 "밖에서 안 보인다"이지 "안에서 못 쓴다"가 아니다.
5. ① 전역 변수는 먼저 제로 초기화된 뒤 동적 초기화가 돈다. 이 빌드에서는 `gait.cpp`의 동적 초기화가 `config.cpp`보다 먼저 실행됐고, 그 시점의 `default_speed`는 아직 제로 초기화 상태(0)라 `0 * 2 = 0`이 저장됐다. 번역 단위 간 동적 초기화 순서는 표준이 정의하지 않으므로 어느 쪽도 "버그 있는 빌드"가 아니다 — 그게 이 함정의 요점이다. ② 함수-로컬 static의 초기화 시점은 "첫 호출 순간"으로 언어가 정의한다. 읽는 순간 값이 만들어지므로, 읽기 전에 초기화가 안 돼 있는 상황이 구조적으로 불가능하다.
:::

읽은 것을 심볼로 확인하기 전에는 이 절은 끝난 게 아니다. 지금 IDE 터미널에서 연습문제 3번과 4번을 돌려라 — 기준 명령은 `g++ -std=c++20 -Wall -Wextra -c a.cpp b.cpp && nm -C a.o b.o`다. `T`가 `W`로, `T`가 `t`로 바뀌는 것을 직접 본 사람과 글로 읽은 사람의 이해는 다르다. 이것으로 Part I — 소스에서 실행파일까지 — 가 끝났다. 다음 파트부터는 실행 중인 프로그램의 메모리로 들어간다.

**다음 절**: [2.1 메모리 모델](#/memory-model) — 방금 본 "제로 초기화 상태의 전역"이 사는 정적 영역부터, 스택 프레임과 힙 블록이 실제로 어떻게 움직이는지를 위젯으로 연다.
