# 1.5 제어 흐름과 표현식

::: lead
if와 for의 사용법을 다시 배우는 절이 아니다 — 그건 당신이 이미 안다. 이 절은 C++이 다른 언어와 다르게 행동하는 지점만 짚는다. 대입이 표현식이라서 `if (x = 0)`이 합법인 언어, 함수 인자의 평가 순서가 컴파일러마다 다른 언어, switch가 기본적으로 아래로 흘러내리는 언어에서 제어 흐름을 쓴다는 것이 무엇인지 실측으로 확인한다. 마지막에는 이 모든 것이 모이는 자리 — 로봇의 제어 주기 루프 — 까지 간다.
:::

## == 하나가 빠진 날

에러 코드를 검사하는 평범한 코드다. 단 한 글자가 빠졌다.

```cpp title="assign.cpp — == 를 쓰려다 = 를 썼다" {5}
#include <iostream>

int main() {
    int error_code = 42;              // 이전 단계에서 받은 에러
    if (error_code = 0) {
        std::cout << "에러 없음, 계속 진행\n";
    } else {
        std::cout << "에러 발생: " << error_code << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 assign.cpp -o assign
$ ./assign
에러 발생: 0
```

경고 플래그 없이 컴파일하면 **에러도 경고도 없다.** 실행하면 else로 갔으니 얼핏 맞게 동작한 것 같지만, 출력을 봐라 — 에러 코드가 0이다. `error_code = 0`은 비교가 아니라 **대입**이고, 대입식의 값은 대입된 값(0)이므로 조건은 false가 됐다. 분기가 뒤집힌 것에 더해 원래 있던 에러 코드 42가 **파괴됐다.** 로그에는 "에러 발생: 0"이 찍히고, 어떤 에러였는지는 영영 알 수 없다.

`-Wall`을 켜면 g++ 13이 정확히 잡는다.

```console
$ g++ -std=c++20 -Wall -Wextra assign.cpp -o assign
assign.cpp:5:20: warning: suggest parentheses around assignment used as truth value [-Wparentheses]
    5 |     if (error_code = 0) {
      |         ~~~~~~~~~~~^~~
```

::: danger 이 버그는 컴파일러의 눈에는 정상 코드다
`if (x = 0)`은 문법 오류가 아니라 **완전히 합법인 C++**이다. `-Wparentheses`는 `-Wall`에 포함되지만, [0.3](#/first-build)에서 세운 원칙 — 경고 0개, 가능하면 `-Werror` — 없이는 이 한 글자가 코드 리뷰까지 통과한다. 정말로 조건 안에서 대입하고 싶은 드문 경우에는 경고 메시지가 시키는 대로 괄호를 하나 더 감아 `if ((x = next()))`라고 쓴다 — "의도한 대입"이라는 신호다.
:::

::: hist 왜 대입이 표현식인가
C의 설계다. `while ((c = getchar()) != EOF)`처럼 "읽고, 저장하고, 검사한다"를 한 줄에 쓰는 것이 1970년대 C의 자랑이었고, C++은 이 규칙을 그대로 물려받았다. 편의와 함정은 같은 뿌리에서 나왔고, 그 함정을 메우는 공식 수단이 컴파일러 경고다.
:::

## 표현식과 문장: C++이 둘을 가르는 선

위 버그가 성립하는 이유를 일반화하면 이 절의 뼈대가 나온다. **표현식(expression)은 평가되어 값과 타입을 낳는 코드**이고, **문장(statement)은 실행될 뿐 값이 없는 코드**다. `3 + 4`, `x = 0`, `f()`, `x++` 는 전부 표현식이다 — 대입도, 증가도 값을 낳는다. `if`, `for`, `return`, 선언은 문장이다.

C++에서 이 구분이 중요한 이유는 **표현식이 값을 낳는 자리라면 어디든 들어갈 수 있기** 때문이다. `if (error_code = 0)`이 합법인 것은 `error_code = 0`이 값 0을 낳는 표현식이라 조건 자리에 들어갈 자격이 있어서다. 표현식에 부수효과(side effect) — 변수를 바꾸고, 출력을 하는 일 — 가 붙을 수 있다는 것까지 합치면, C++의 함정 하나가 완성된다: **값을 계산하는 자리에서 상태가 바뀐다.**

### 삼항 연산자: 값을 만드는 분기

if는 문장이라 값이 없다. 값이 필요한 분기는 삼항 연산자 `?:` — C++에서 유일하게 피연산자를 셋 받는 연산자 — 가 맡는다.

```cpp title="tern.cpp — 조각: 핵심만"
int clamped = angle > limit_deg ? limit_deg : angle;   // 값을 낳는 분기

auto v = true ? 1 : 2.5;                               // 두 팔의 타입이 다르면?
```

```console
$ ./tern
clamped = 90
double? true, v = 1
```

관절 각도를 한계로 자르는 첫 줄은 if 넉 줄을 한 줄로 줄이고, `clamped`를 `const`로 만들 수 있게 해 준다(if로 나눠 쓰면 선언과 대입이 분리되어 const가 불가능하다). 둘째 줄이 함정이다 — 두 팔의 타입이 `int`와 `double`로 다르면 삼항 연산자는 **공통 타입으로 수렴**시킨다. 실측대로 `v`의 타입은 double이다. [1.2](#/types)에서 본 암묵 변환이 여기서도 조용히 일어난다는 뜻이다. 두 팔의 타입을 맞춰 써라. 그리고 삼항을 삼항 안에 중첩하지 마라 — 값이 필요한 분기가 셋 이상이면 함수로 빼는 게 맞다.

## 평가 순서: 컴파일러마다 다른 답

표현식에 부수효과가 붙을 수 있다면, 한 문장 안에 부수효과가 둘이면 어느 쪽이 먼저인가. 실측부터 본다.

```cpp title="seq.cpp"
#include <cstdio>

void log_pair(int a, int b) {
    std::printf("a=%d b=%d\n", a, b);
}

int main() {
    int i = 0;
    log_pair(i++, i++);   // 어느 인자가 먼저 평가되는가?
    std::printf("i=%d\n", i);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra seq.cpp -o seq
seq.cpp:9:20: warning: operation on 'i' may be undefined [-Wsequence-point]
$ ./seq
a=1 b=0
$ clang++ -std=c++20 seq.cpp -o seq_clang && ./seq_clang
a=0 b=1
```

**같은 코드가 g++에서는 `a=1 b=0`, clang++에서는 `a=0 b=1`이다.** g++ 13은 인자를 오른쪽부터, clang 18은 왼쪽부터 평가했다. 둘 다 표준에 부합한다 — C++ 표준은 함수 인자 간 평가 **순서를 정하지 않았다.**

여기서 용어를 정확히 가른다. C++17부터 함수 인자들은 서로 **겹치지 않게**(한 인자의 평가가 끝난 뒤 다음 인자가 시작되게) 평가되는 것이 보장됐다. 그래서 `log_pair(i++, i++)`는 UB가 아니다 — g++ 경고문의 "may be undefined"는 C++14 이전 규칙 시절의 문구가 남은 것이다. 하지만 **어느 인자가 먼저인지는 여전히 미지정(unspecified)이다.** 미지정 동작은 UB와 다르다 — 프로그램이 폭주하지는 않고 가능한 결과 중 하나가 나오지만, 어느 것이 나올지는 컴파일러 마음이다. 실측이 보여준 그대로, 컴파일러를 바꾸면 결과가 바뀐다.

반면 연산자의 피연산자는 사정이 더 나쁘다. `i++ + i++`처럼 `+`의 양쪽에서 같은 변수를 수정하면 두 수정 사이에 아무 순서 보장이 없고(unsequenced), 이것은 C++20에서도 **UB다** — [1.2](#/types)에서 만난 signed 오버플로와 같은 급이다. 함수 인자는 미지정, 일반 연산자 피연산자는 UB. 결론은 하나로 수렴한다.

::: warn 한 문장에서 같은 변수를 두 번 수정하지 마라
`f(i++, i++)`, `i++ + i++`, `v[i] = i++` — 전부 쓰지 마라. 규칙의 세부(미지정이냐 UB냐)를 외우는 것보다, **부수효과 하나당 문장 하나**라는 습관이 낫다. `-Wsequence-point`(‑Wall 포함)가 잡아 주는 것은 이 중 일부뿐이다.
:::

### 단락 평가: 순서가 보장되는 예외

평가 순서가 정해지지 않은 세계에서 `&&`, `||`, `,`, `?:`는 예외다 — **왼쪽을 먼저 평가하고, 그 결과가 확정되면 오른쪽을 아예 평가하지 않는다.** 이것을 단락 평가(short-circuit evaluation)라 한다. 실측:

```cpp title="shortc.cpp — 조각: 검사 함수 둘"
bool check_battery() { std::printf("battery checked\n"); return false; }
bool check_motors()  { std::printf("motors checked\n");  return true;  }

if (check_battery() && check_motors()) { /* ... */ }   // 배터리가 false 면?
```

```console
$ ./shortc
-- && --
battery checked
-- || --
battery checked
motors checked
at least one ok
```

`&&`에서 `check_battery()`가 false를 돌려주자 `check_motors()`는 **호출조차 되지 않았다** — "motors checked"가 없다. `||`는 왼쪽이 false라서 오른쪽까지 갔다. 단락 평가는 최적화가 아니라 **언어가 보장하는 의미론**이고, 그래서 관용구가 성립한다.

```cpp title="nullchk.cpp — 조각: 단락 평가가 지키는 접근"
Imu* imu = nullptr;
if (imu != nullptr && imu->yaw > 1.0) {   // && 가 오른쪽 평가를 막는다
    // ...
}
```

왼쪽이 false면 오른쪽의 `imu->yaw`는 실행되지 않으므로, 널 포인터 역참조가 원천적으로 차단된다. 순서를 뒤집어 `imu->yaw > 1.0 && imu != nullptr`라고 쓰면 보호가 사라진다 — **싼 검사, 막아주는 검사를 왼쪽에 둔다.** 이 관용구는 [2.2 포인터](#/pointers)부터 책 전체에서 계속 쓴다.

::: interview 단락 평가는 항상 보장되는가
"`a && b`에서 b가 평가되지 않을 수 있는가, 그 보장이 깨지는 경우는?"이 단골이다. 답변 뼈대: ① 내장 `&&`/`||`는 왼쪽 우선 평가와 단락을 **표준이 보장**한다 — 널 체크 후 접근(`p && p->x`) 관용구의 근거다. ② 단, `&&`/`||`를 **연산자 오버로딩**하면 단락이 사라진다 — 오버로드된 연산자는 일반 함수 호출이라 양쪽 인자가 모두 평가된다. 그래서 스마트 포인터 라이브러리도 `&&` 오버로드는 만들지 않는 것이 관례다. ③ 덤: `&`와 `&&`를 혼동하면 비트 AND는 단락하지 않으므로 오른쪽 부수효과가 항상 실행된다. 오버로딩 이야기까지 나오면 상급이다 — [3.6 연산자 오버로딩](#/operator-overloading)에서 다시 만난다.
:::

## switch의 지뢰밭

switch는 C++에서 가장 오해되는 제어문이다. 다른 언어의 switch(또는 match)를 생각하고 쓰면 두 번 당한다.

### fallthrough는 기본 동작이다

case는 분기가 아니라 **점프 목적지(라벨)** 다. 일치하는 case로 뛰어든 뒤에는 `break`를 만날 때까지 **아래 case의 코드까지 계속 실행한다.** 이것이 fallthrough다.

```cpp title="fall.cpp — break 를 하나 잊었다" {8}
#include <cstdio>

enum class GaitState { Idle, Standing, Walking, Fault };

void report(GaitState s) {
    switch (s) {
    case GaitState::Idle:
        std::printf("idle\n");
    case GaitState::Standing:      // break 를 잊었다
        std::printf("standing\n");
    case GaitState::Walking:
        std::printf("walking\n");
        break;
    case GaitState::Fault:
        std::printf("fault\n");
        break;
    }
}

int main() {
    report(GaitState::Idle);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra fall.cpp -o fall
fall.cpp:8:20: warning: this statement may fall through [-Wimplicit-fallthrough=]
    8 |         std::printf("idle\n");
fall.cpp:9:5: note: here
    9 |     case GaitState::Standing:      // break 를 잊었다
$ ./fall
idle
standing
walking
```

Idle 하나를 넣었는데 세 줄이 찍혔다 — Idle에서 시작해 Standing, Walking까지 흘러내렸다. 상태 머신이라면 "대기 상태를 보고하라"는 호출이 "걷는 중" 처리 코드까지 실행한 것이다. 다행히 g++ 13은 `-Wextra`가 `-Wimplicit-fallthrough`를 켠다(실측: `-Wall`만으로는 침묵했다). [0.3](#/first-build)의 "경고 0개" 원칙에 `-Wextra`가 반드시 포함되어야 하는 이유가 하나 더 늘었다.

fallthrough가 **의도**인 경우도 있다 — 여러 상태가 같은 처리를 공유하거나, 누적 효과를 계단식으로 쌓을 때다. 그때는 C++17의 `[[fallthrough]]` 속성으로 의도를 문법에 새긴다.

```cpp title="fall2.cpp — 조각: 의도한 통과"
switch (lv) {
case LogLevel::Debug:
    std::printf("debug on\n");
    [[fallthrough]];               // 의도한 통과임을 컴파일러에 선언
case LogLevel::Info:
    std::printf("info on\n");
    [[fallthrough]];
case LogLevel::Error:
    std::printf("error on\n");
    break;
}
```

실측으로 이 코드는 `-Wall -Wextra`에서 경고가 없고, Debug를 넣으면 세 줄이 다 찍힌다 — 로그 레벨처럼 "이 레벨 이상 전부 켠다"는 계단식 의미에 fallthrough가 정확히 맞는 드문 예다. 주석 `// fall through`가 아니라 속성을 써라 — 컴파일러는 주석을 읽지 않는다.

::: hist 왜 fallthrough가 기본인가
C의 switch는 점프 테이블로 컴파일되는 것을 전제로 한, `goto`의 구조화된 포장이다. case는 정말로 라벨이고, break가 없으면 다음 라벨을 지나쳐 계속 실행되는 것이 어셈블리 관점에서는 자연스러웠다. 후대 언어들은 이 기본값을 실수의 근원으로 판정해 버렸지만(C#은 컴파일 에러, Rust의 match는 fallthrough 자체가 없다), C++은 C 호환성 때문에 기본값을 못 바꾸는 대신 경고와 속성으로 메웠다 — C++이 함정을 고치는 전형적인 방식이다.
:::

### -Wswitch: 상태 머신의 생명줄

switch의 두 번째 지뢰는 fallthrough보다 조용하다 — **케이스 누락**이다. 위의 `GaitState`에 새 상태를 추가했는데 어딘가의 switch 하나를 고치지 않았다면? `enum class`([1.8](#/structs-enums)에서 전모를 다룬다)와 `-Wswitch`의 조합이 이것을 컴파일 타임에 잡는다.

```cpp title="wswitch.cpp — Fault 처리를 빠뜨렸다"
#include <cstdio>

enum class GaitState { Idle, Standing, Walking, Fault };

const char* name(GaitState s) {
    switch (s) {                       // default 없음 — 그게 핵심이다
    case GaitState::Idle:     return "idle";
    case GaitState::Standing: return "standing";
    case GaitState::Walking:  return "walking";
    }                                  // Fault 를 빠뜨렸다
    return "?";
}

int main() { std::printf("%s\n", name(GaitState::Fault)); return 0; }
```

```console
$ g++ -std=c++20 -Wall -Wextra wswitch.cpp -o wswitch
wswitch.cpp:6:12: warning: enumeration value 'Fault' not handled in switch [-Wswitch]
```

`-Wswitch`(`-Wall` 포함)가 정확히 짚었다: Fault가 처리되지 않았다. 이 경고가 로봇 코드에서 왜 생명줄인가. 보행 상태 머신에 `Emergency` 상태를 추가하는 날, 그 상태를 분기하는 switch는 코드베이스에 열 개쯤 흩어져 있다. 이 경고가 켜져 있으면 **컴파일러가 열 곳 전부의 목록을 뽑아 준다.** 꺼져 있으면, 빠뜨린 한 곳은 비상 정지 명령을 조용히 무시하는 로봇이 되어 현장에서 발견된다.

::: danger default가 이 경고를 죽인다
같은 switch에 `default:`를 넣고 실측하면 **경고가 사라진다** — 컴파일러 입장에서는 모든 값이 처리되고 있기 때문이다. 그래서 enum을 분기하는 switch의 원칙은 이렇다: **모든 케이스를 명시하고 default를 쓰지 마라.** "혹시 모르니 default"는 안전장치가 아니라 컴파일 타임 검증을 버리는 행위다. 처리할 수 없는 값이 정말 걱정되면(직렬화된 바이트에서 캐스팅한 enum 등) switch 바깥에서 별도로 검증하라 — [1.4](#/casting)에서 본 정수 → enum 캐스팅이 바로 그 경우다.
:::

## 범위 기반 for 미리보기

컨테이너와 배열의 순회는 인덱스 루프가 아니라 범위 기반 for(range-based for)가 기본형이다. 함정은 하나 — **루프 변수는 기본적으로 복사본**이다.

```cpp title="rfor.cpp"
#include <cstdio>

int main() {
    int pwm[6] = {10, 20, 30, 40, 50, 60};

    for (int v : pwm) v += 5;          // v 는 복사본 — 원본 불변
    std::printf("after value loop : %d\n", pwm[0]);

    for (int& v : pwm) v += 5;         // 참조 — 원본이 바뀐다
    std::printf("after ref loop   : %d\n", pwm[0]);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra rfor.cpp -o rfor
$ ./rfor
after value loop : 10
after ref loop   : 15
```

첫 루프는 `v`에 각 원소를 **복사**해서 5를 더했다 — 복사본만 바뀌고 배열은 그대로다(실측 10). `int&`로 받은 두 번째 루프만 원본을 바꿨다(실측 15). 선택 기준은 세 갈래다: 수정하려면 `auto&`, 읽기만 하는데 원소가 크면(구조체, string) `const auto&`, 원소가 int/double 같은 작은 값이면 `auto` 복사로 충분하다. 원소가 큰 객체일 때 복사 루프가 얼마나 비싼지는 실측과 함께 [2.6 복사 시맨틱](#/copy-semantics)과 [5.4 반복자와 무효화 규칙](#/iterators)에서 정면으로 다룬다 — 범위 기반 for가 실제로는 반복자 코드로 펼쳐지는 문법 설탕이라는 것도 거기서 확인한다.

## C++17이 조건문에 준 것

### if의 init-statement

for는 처음부터 `for (int i = 0; ...)`처럼 자기 스코프의 변수를 만들 수 있었다. C++17은 같은 능력을 if와 switch에 줬다 — 세미콜론으로 구분된 **init-statement**다.

```cpp title="ifinit.cpp — 조각: 찾고, 검사하고, 스코프를 닫는다"
if (auto it = gains.find("kp"); it != gains.end()) {
    std::printf("kp = %.1f\n", it->second);
} else {
    std::printf("kp 없음\n");
}
// it 는 여기서 이미 소멸 — 스코프 밖
```

실측 출력은 `kp = 4.0`이다. 이 문법이 없던 시절에는 `it`를 if 바깥에 선언해야 했고, 그러면 검사가 끝난 뒤에도 `it`가 살아남아 아래 코드가 실수로 재사용할 수 있었다. init-statement는 **변수의 수명을 그 변수가 의미 있는 분기 안으로 가둔다** — [1.3](#/variables)에서 세운 "스코프는 좁을수록 좋다" 원칙의 문법적 완성이다. `map::find`처럼 "찾고 나서 성공 여부를 검사하는" API와 만날 때 기본형으로 써라. switch에도 같은 문법이 있다: `switch (auto s = poll(); s)`.

### if constexpr — 예고만

`if constexpr (조건)`은 조건을 **컴파일 타임에** 평가해서, 거짓인 가지의 코드를 아예 컴파일 대상에서 제거하는 분기다. 런타임 if와는 완전히 다른 물건이고, 템플릿 코드에서 타입에 따라 구현을 갈라 쓸 때 진가가 나온다. 템플릿 없이는 위력을 보여줄 수 없으므로 여기서는 이름만 걸어 둔다 — [4.6 constexpr와 컴파일 타임 계산](#/constexpr)의 주제다.

## goto는 안 쓴다 — 대신 함수를 쪼갠다

C++에 goto는 있다. 이 책에서는 쓰지 않고, 정당화되는 마지막 용례였던 **중첩 루프 탈출**도 더 나은 관용구가 있다. 2중 루프 안쪽에서 장애물을 찾으면 두 루프를 다 빠져나와야 한다고 하자. `bool found` 플래그를 만들어 두 루프의 조건에 끼워 넣는 방법은 루프 조건을 오염시키고, goto는 흐름을 라벨로 흩어 놓는다. 답은 **루프를 함수로 분리하고 return으로 나오는 것**이다.

```cpp title="grid.cpp — 조각: return 이 이중 break 다"
// 중첩 루프 탈출은 플래그도 goto 도 아니고 함수 분리 + return
std::optional<Cell> find_obstacle(const int (&grid)[3][4]) {
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 4; ++c)
            if (grid[r][c] != 0) return Cell{r, c};
    return std::nullopt;
}
```

`return`은 몇 겹의 루프든 한 번에 뚫고 나온다. 부산물이 둘 생긴다: 루프에 `find_obstacle`이라는 이름이 붙었고, "못 찾았다"가 매직 넘버가 아니라 `std::optional`([5.9](#/vocabulary-types)의 주제)의 빈 상태로 표현됐다. 실측 출력은 `obstacle at (1, 2)`다. 루프가 함수로 빠질 수 없는 자리라면 즉시 실행 람다로 같은 효과를 내는 수도 있다 — [5.6 람다](#/lambdas)에서 다룬다.

## 제어 주기 루프: 로봇의 심장 박동

실전 구조 하나로 마친다. 로봇 제어 코드의 뼈대는 이벤트가 아니라 **주기**다 — 100 Hz라면 10 ms마다 "센서를 읽고, 제어를 계산하고, 명령을 쓰는" 루프가 돈다.

```cpp title="loop.cpp — 100 Hz 제어 루프의 뼈대"
#include <chrono>
#include <cstdio>
#include <thread>

int main() {
    using clock = std::chrono::steady_clock;
    constexpr auto period = std::chrono::milliseconds(10);   // 100 Hz

    auto next = clock::now();
    for (int tick = 0; tick < 5; ++tick) {
        auto start = clock::now();

        // (여기서 센서 읽기 → 제어 계산 → 명령 쓰기)

        next += period;                       // 기준점을 절대 시각으로 민다
        std::this_thread::sleep_until(next);

        auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
                           clock::now() - start).count();
        std::printf("tick %d: %ld us\n", tick, elapsed);
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 loop.cpp -o loop
$ ./loop
tick 0: 10097 us
tick 1: 10005 us
tick 2: 9998 us
tick 3: 10046 us
tick 4: 9964 us
```

10,000 µs 목표에 실측 9,964~10,097 µs — 일반 리눅스 데스크톱에서도 오차 1% 안쪽이다. 구조에서 두 가지만 봐 둬라. 첫째, `sleep_for(period)`가 아니라 `sleep_until(next)`다 — sleep_for는 "작업에 걸린 시간 + 10 ms"를 자므로 매 주기의 처리 시간만큼 오차가 **누적**되지만, sleep_until은 절대 시각 기준이라 오차가 다음 주기로 이월되지 않는다. 둘째, 루프 안의 분기는 공짜가 아니다 — 매 주기 실행되는 코드의 if 하나하나가 CPU의 분기 예측과 만나는 이야기는 [8.2 캐시와 메모리 레이아웃](#/cache)에서 실측으로 다룬다. 그리고 이 주기가 흔들리는 것(지터)이 왜 제어 품질을 직접 깎는지, 루프 안에서 무엇을 하면 안 되는지는 [6.8 실시간 제약과 제어 루프](#/realtime)의 주제다 — 이 절의 다섯 줄짜리 뼈대가 그 절에서 실시간 등급으로 자란다.

## 요약

- `if (x = 0)`은 합법이다 — 대입은 값을 낳는 **표현식**이라 조건 자리에 들어간다. 분기가 뒤집히고 원본 값까지 파괴되는 이중 버그이며, `-Wall`의 `-Wparentheses`가 잡는다(실측).
- 함수 인자 간 평가 순서는 **미지정**이다 — 같은 `f(i++, i++)`가 g++는 `a=1 b=0`, clang은 `a=0 b=1`(실측). 연산자 피연산자에서 같은 변수를 두 번 수정하면 UB. 원칙: **부수효과 하나당 문장 하나.**
- `&&`/`||`는 예외적으로 왼쪽 우선 + 단락 평가가 **보장**된다 — `p != nullptr && p->x` 관용구의 근거. 단, 오버로드하면 단락이 사라진다.
- switch의 case는 라벨이고 fallthrough가 기본 동작이다(실측: Idle 하나에 세 줄 출력). 경고는 `-Wextra`가 켜는 `-Wimplicit-fallthrough`, 의도한 통과는 `[[fallthrough]]`.
- enum을 분기하는 switch는 **모든 케이스 명시 + default 금지** — `-Wswitch`가 새 상태 추가 시 누락된 switch 전부를 컴파일 타임에 뽑아 준다. default를 넣는 순간 이 검증이 죽는다(실측).
- 범위 기반 for의 루프 변수는 복사본이다(실측: 원본 불변). 수정은 `auto&`, 큰 원소 읽기는 `const auto&`.
- C++17 init-statement `if (auto it = m.find(k); it != m.end())`는 변수 수명을 분기 안에 가둔다. `if constexpr`는 [4.6](#/constexpr)에서.
- 중첩 루프 탈출은 goto도 플래그도 아니라 **함수 분리 + return**. 제어 주기 루프는 `sleep_for`가 아니라 `sleep_until`로 오차 누적을 막는다(실측: 100 Hz에서 오차 1% 안쪽).

::: quiz 연습문제
1·2번은 예측·개념 문제, 3번은 설계 문제, 4·5번은 네 컴퓨터에서 확인하는 실습이다.

1. 다음 코드의 출력을 **컴파일하지 말고** 예측하라. `sensor_ok`의 최종 값도 함께 답하라.

   ```cpp
   bool sensor_ok = true;
   if (sensor_ok = false) {
       std::cout << "센서 정상\n";
   } else {
       std::cout << "센서 이상\n";
   }
   ```

2. `f(i++, i++)`와 `i++ + i++`는 표준이 취급하는 급이 다르다. 각각 무엇(미지정/UB)이고, 왜 다른지 한 문장씩으로 설명하라. C++17이 바꾼 것은 어느 쪽인가.

3. 보행 상태 머신의 `switch (state)`에 동료가 "안전하게 default: return Error;를 넣자"고 제안했다. 무엇을 얻고 무엇을 잃는지 이 절의 실측을 근거로 답하고, 대안을 제시하라.

4. (실습) `-Wswitch` 재현: 상태 4개짜리 `enum class`를 만들고, 케이스를 하나 빠뜨린 switch를 `g++ -std=c++20 -Wall -Wextra -c`로 컴파일해 `not handled in switch` 경고를 재현하라. 그다음 `default:`를 추가하고 경고가 **사라지는 것**을 확인하라. 성공 기준: 경고가 default 없는 버전에서만 난다.

5. (실습) fallthrough 두 방향: `break` 없는 case가 있는 switch를 써서 ① `-Wall`만으로는 경고가 없고 `-Wextra`를 붙여야 `-Wimplicit-fallthrough` 경고가 나는 것을 확인하라. ② 그 자리에 `[[fallthrough]];`를 넣어 경고를 침묵시켜라. 성공 기준: `-Wall -Wextra`에서 경고 0개, 실행 출력은 통과 전후 동일.
:::

::: answer 해설
1. 출력은 `센서 이상`, `sensor_ok`는 false다. `sensor_ok = false`는 비교가 아니라 대입이고, 대입식의 값은 false이므로 else로 간다. 본문의 assign.cpp와 같은 이중 버그다 — 분기도 틀렸고 원래 true였던 상태 플래그도 파괴됐다. `-Wall`이 `-Wparentheses`로 잡는다.
2. `f(i++, i++)`는 **미지정** — C++17부터 인자끼리는 겹치지 않게 평가되는 것이 보장되어 UB는 아니지만, 어느 인자가 먼저인지는 컴파일러 마음이다(본문 실측: g++와 clang의 출력이 달랐다). `i++ + i++`는 **UB** — `+`의 피연산자 평가는 C++20에서도 unsequenced라 같은 변수의 두 수정이 충돌한다. C++17이 바꾼 것은 함수 인자 쪽(unsequenced → indeterminately sequenced)이다.
3. 얻는 것: 열거값이 아닌 쓰레기 값(직렬화 버그 등으로 캐스팅된 범위 밖 정수)이 들어와도 정의된 경로로 빠진다. 잃는 것: 본문 실측대로 **default가 있으면 `-Wswitch` 경고가 죽는다** — 새 상태를 추가한 날 누락된 switch를 컴파일러가 더 이상 찾아 주지 않는다. 대안: switch 안에서는 모든 케이스를 명시하고 default를 빼서 경고를 살리고, 범위 밖 값 검증은 enum으로 캐스팅하는 **경계 지점**(수신 코드)에서 한 번만 한다.
4. g++ 13 실측 기준: default 없는 버전에서 `warning: enumeration value 'X' not handled in switch [-Wswitch]`, default를 넣으면 침묵. 이 실습의 목적은 "default는 공짜 안전장치가 아니라 컴파일 타임 검증과의 교환"임을 눈으로 보는 것이다.
5. g++ 13 실측 기준: ①에서 `-Wall`만으로는 침묵하고 `-Wextra`를 붙이면 `this statement may fall through [-Wimplicit-fallthrough=]`가 난다(-Wextra가 이 경고를 켠다). ②에서 `[[fallthrough]];`를 넣으면 같은 플래그로 경고 0개. 실행 출력이 안 변하는 것도 확인하라 — 속성은 실행 의미가 아니라 **의도 선언**만 바꾼다.
:::

이 절의 코드는 전부 짧다. 전부 직접 쳐라. 특히 `seq.cpp`는 g++와 clang++ 양쪽으로 컴파일해서 출력이 다른 것을 네 눈으로 확인하고, `loop.cpp`는 주기를 1 ms로 줄여 오차가 어떻게 변하는지 실험해 보라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`이다.

**다음 절**: [1.6 함수: 오버로딩과 인자 전달](#/functions) — 제어 흐름의 최종 형태는 함수 호출이다. 인자를 값으로 넘길 때 실제로 복사되는 비용과, 컴파일러가 오버로드 중 하나를 고르는 규칙을 해부한다.
