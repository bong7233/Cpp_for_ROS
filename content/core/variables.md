# 1.3 변수, 초기화, 스코프

::: lead
[1.2](#/types)에서 타입이 "메모리를 해석하는 규칙"임을 봤다. 이번 절은 그 규칙이 적용될 값이 **태어나는 순간(초기화)** 과 **살아 있는 구간(스코프와 수명)** 을 다룬다. 파이썬이나 자바를 쓰던 사람이 C++에서 가장 먼저 밟는 지뢰가 여기 있다 — C++은 지역 변수를 0으로 만들어 주지 않고, 초기화 문법이 세 가지나 되며, 그 셋의 의미가 미묘하게 다르다. 이 절이 끝나면 당신은 변수를 선언하는 한 줄에서 세 가지 결정 — 어떤 문법으로, 어떤 값으로, 어디에 — 을 의식적으로 내리게 된다.
:::

## 초기화 안 된 변수 안에는 무엇이 있나

정의 대신 실험부터. 아래 프로그램은 변수를 선언만 하고 값을 주지 않은 채 출력한다.

```cpp title="uninit.cpp"
#include <iostream>

int main() {
    int sensor_value;
    std::cout << sensor_value << "\n";
    return 0;
}
```

경고 플래그 없이 `-O0`으로 빌드하고 **세 번** 실행한다.

```console
$ g++ -std=c++20 -O0 uninit.cpp -o uninit
$ ./uninit
32766
$ ./uninit
32765
$ ./uninit
32767
```

(g++ 13.3 / -O0 / Linux x86-64 실측. 이 값은 실행마다, 기기마다, 최적화 레벨마다 다르다 — 당신의 컴퓨터에서는 다른 숫자가 나온다.)

`sensor_value`에 값을 준 적이 없는데 32766이 나왔다. 어디서 온 숫자인가. `int sensor_value;`라는 선언은 스택에 4바이트를 **확보**할 뿐, 그 자리를 **채우지 않는다**. 출력된 것은 그 메모리 자리에 우연히 남아 있던 이전 비트다. 실행 환경이 조금만 달라져도 남아 있는 비트가 달라지므로 값이 매번 바뀐다.

**C++은 초기화를 공짜로 주지 않는다.** 파이썬에는 "값 없는 변수"라는 개념 자체가 없고, 자바는 필드를 0으로 채워 준다. C++은 지역 변수에 대해 아무것도 하지 않는다. 더 나쁜 소식: 초기화 안 된 변수를 읽는 것은 단순히 "쓰레기값이 나온다"가 아니라 **미정의 동작(undefined behavior)** 이다. 이 환경에서는 쓰레기 숫자가 출력됐지만, 표준은 어떤 결과도 보장하지 않는다 — 최적화가 켜지면 그 변수를 읽는 분기 전체가 삭제되는 일도 실제로 일어난다. 미정의 동작의 전모는 [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 해부한다.

::: deep 왜 0으로 채워 주지 않는가
자바처럼 전부 0으로 채우면 안전할 텐데 왜 안 하는가. **제로 오버헤드 원칙** — 쓰지 않는 기능에 비용을 내지 않는다 — 때문이다. 지역 변수는 함수 호출마다 스택에 만들어진다([2.1 메모리 모델](#/memory-model)에서 본다). 어차피 다음 줄에서 센서값으로 덮어쓸 변수를 매번 0으로 채우는 것은 명령어 낭비이고, 1kHz 제어 루프처럼 초당 수천 번 도는 코드에서는 그 낭비가 쌓인다. C++의 태도는 일관된다: 기본값 채우기가 필요하면 프로그래머가 명시하라, 언어는 강요하지 않는다. 안전이 언어의 기본값이 아니므로, 안전은 당신의 습관이어야 한다.
:::

### -Wall이 잡아 주는 경우

[0.3](#/first-build)에서 약속한 `-Wall -Wextra`를 붙이면 위 코드는 이렇게 잡힌다.

```console
$ g++ -std=c++20 -Wall -Wextra -O0 uninit.cpp -o uninit
uninit.cpp: In function 'int main()':
uninit.cpp:5:34: warning: 'sensor_value' is used uninitialized [-Wuninitialized]
    5 |     std::cout << sensor_value << "\n";
      |                                  ^~~~
uninit.cpp:4:9: note: 'sensor_value' was declared here
    4 |     int sensor_value;
      |         ^~~~~~~~~~~~
```

선언 후 한 번도 대입하지 않고 읽는 단순한 경우는 `-Wuninitialized`가 최적화 레벨과 무관하게 잡는다. 여기까지만 보면 경고를 믿고 살아도 될 것 같다. 그런데.

### -Wall이 못 잡는 경우

조건에 따라 초기화가 **될 수도, 안 될 수도** 있는 코드로 바꿔 보자.

```cpp title="pwm.cpp — mode가 0/1/2가 아니면 duty는 미초기화다"
int clamp(int v);

int pwm_duty(int mode) {
    int duty;
    switch (mode) {
        case 0: duty = 0;    break;
        case 1: duty = 50;   break;
        case 2: duty = 100;  break;
    }
    return clamp(duty);
}
```

`-O0`에서는 **아무 경고도 없다.** `-O2`를 붙여야 잡힌다.

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -c pwm.cpp
$ g++ -std=c++20 -Wall -Wextra -O2 -c pwm.cpp
pwm.cpp: In function 'int pwm_duty(int)':
pwm.cpp:10:17: warning: 'duty' may be used uninitialized [-Wmaybe-uninitialized]
   10 |     return clamp(duty);
      |            ~~~~~^~~~~~
pwm.cpp:4:9: note: 'duty' was declared here
    4 |     int duty;
      |         ^~~~
```

이번 경고 이름은 `-Wmaybe-uninitialized` — "확실히"가 아니라 "아마도"다. 이 분석은 최적화 과정에서 만들어지는 데이터 흐름 정보를 쓰기 때문에 **최적화를 켜야만 작동한다.** 디버그 빌드(-O0)에서만 컴파일하며 개발하면 이 계열의 경고를 통째로 놓친다는 뜻이다.

더 불편한 사실도 있다. `switch`를 `if`로 바꾼 아래 코드는 같은 구멍이 있는데도 g++ 13.3이 **어느 최적화 레벨에서도 침묵한다.**

```cpp title="branch.cpp — mode != 1 이면 limit은 미초기화. 그런데 경고가 없다"
int scale(int v);

int limit_of(int mode) {
    int limit;
    if (mode == 1) {
        limit = 100;
    }
    return scale(limit);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O0 -c branch.cpp
$ g++ -std=c++20 -Wall -Wextra -O2 -c branch.cpp
$
```

(g++ 13.3 실측. 최적화 과정에서 조건 대입이 변형되면서 미초기화 경로가 분석에서 사라진다. 컴파일러 버전에 따라 잡히기도 한다 — 그게 바로 "경고에 기대면 안 되는" 이유다.)

::: warn 경고는 안전망이지 보증이 아니다
`-Wall -Wextra`는 미초기화 읽기의 일부만 잡는다. 잡는 범위는 최적화 레벨과 컴파일러 버전에 따라 흔들린다. 결론은 하나다 — **경고에 의존하지 말고, 미초기화 상태 자체를 만들지 마라.** 규칙: 변수는 선언하는 그 줄에서 초기화한다. 값이 아직 없으면 선언을 값이 생기는 지점까지 내려라. C++은 (C89와 달리) 블록 중간 어디서든 선언할 수 있다.
:::

::: danger 미초기화 센서값은 로봇에서 이렇게 사고가 된다
`pwm_duty`의 구멍이 실전에서 어떻게 터지는지 보자. 관절 제어 코드가 IMU 초기화 완료 전에 한 틱 먼저 돌면, 미초기화 각도 변수에는 32766 같은 쓰레기가 들어 있다. 제어기는 그것을 "현재 각도 32766도"로 읽고, 목표 0도와의 오차를 줄이려 **최대 토크를 역방향으로** 걸어 버린다. 전원을 켜는 순간 다리가 한계까지 튀는 로봇 — 이 계열 사고의 고전이다. 시뮬레이션에서는 그 메모리 자리가 우연히 0이라 멀쩡하다가 실기체에서만 터지는 것이 이 버그의 악명 높은 성질이다. 제어 루프 설계에서 이 문제를 어떻게 구조적으로 막는지는 [6.8 실시간 제약과 제어 루프](#/realtime)에서 다시 만난다.
:::

## 초기화 문법의 동물원

초기화를 하기로 했으면 이제 문법을 골라야 한다. C++에는 같은 일을 하는 것처럼 보이는 문법이 셋 있다.

```cpp
int a = 5;    // C에서 온 대입 형태
int b(5);     // 생성자 호출 형태
int c{5};     // 중괄호(braced) 초기화 — C++11
```

`int` 하나 초기화하는 데 세 문법이라니 과하다고 느낄 것이다. 맞는 감각이다. 하지만 셋은 장식 차이가 아니라 **동작이 다르다.** 차이가 드러나는 지점이 두 곳 있다.

::: hist 왜 세 가지나 되는가
`=`는 C에서 물려받았고, `()`는 클래스 생성자를 호출하는 문법을 기본 타입까지 확장한 것이다. 문제는 이 둘이 서로 못 하는 일이 있었다는 것 — `=`로는 생성자 인자 여러 개를 못 넘기고, `()`는 아래에서 볼 파싱 함정이 있으며, 배열·구조체 초기화는 또 다른 문법을 썼다. C++11이 "하나로 다 되는" 문법을 목표로 `{}`를 도입했고, 그래서 이름도 **균일 초기화(uniform initialization)** 다. 완전히 균일해지지는 못했지만(vector 사례에서 본다), 새 코드의 기본값이 될 자격은 충분하다.
:::

### 차이 1 — 중괄호는 축소 변환을 거부한다

`double`을 `int`에 욱여넣어 보자. `=`는 조용히 통과시킨다. `-Wall -Wextra`를 켜도 **경고 한 줄 없다.**

```cpp title="narrow4.cpp — 3.14가 소리 없이 3이 된다"
#include <iostream>

int main() {
    int period_ms = 3.14;
    std::cout << period_ms << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra narrow4.cpp -o narrow4
$ ./narrow4
3
```

소수부 0.14는 소멸했고 컴파일러는 아무 말도 하지 않았다. 이것이 **축소 변환(narrowing conversion)** — 표현 범위가 넓은 타입에서 좁은 타입으로 가면서 정보가 잘려 나가는 변환이다. 같은 코드를 중괄호로 바꾸면.

```cpp title="narrow3.cpp — 중괄호는 잘림을 에러로 만든다" {4}
#include <iostream>

int main() {
    int period_ms{3.14};
    std::cout << period_ms << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra narrow3.cpp -o narrow3
narrow3.cpp: In function 'int main()':
narrow3.cpp:4:19: error: narrowing conversion of '3.1400000000000001e+0' from 'double' to 'int' [-Wnarrowing]
    4 |     int period_ms{3.14};
      |                   ^~~~
```

경고가 아니라 **에러**다. 빌드가 멈춘다. 잘림을 의도했다면 그 의도를 캐스트로 명시해야 통과한다 — 어떤 캐스트를 쓰는지는 [1.4 캐스팅과 타입 변환](#/casting)의 주제다. 에러 메시지 속 `3.1400000000000001e+0`이 왜 정확히 3.14가 아닌지는 [1.2](#/types)에서 본 부동소수점 표현의 복습이다.

### 차이 2 — 빈 괄호는 변수가 아니다

"기본값으로 초기화하고 싶다"고 `()`를 쓰면 함정에 빠진다.

```cpp title="vexing3.cpp"
int main() {
    int x();   // 변수를 만들 생각이었다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra vexing3.cpp -o vexing3
vexing3.cpp: In function 'int main()':
vexing3.cpp:2:10: warning: empty parentheses were disambiguated as a function declaration [-Wvexing-parse]
    2 |     int x();   // 변수를 만들 생각이었다
      |          ^~
vexing3.cpp:2:10: note: remove parentheses to default-initialize a variable
    2 |     int x();   // 변수를 만들 생각이었다
      |          ^~
      |          --
vexing3.cpp:2:10: note: or replace parentheses with braces to value-initialize a variable
```

`int x();`는 C 문법과의 호환 때문에 "인자를 안 받고 `int`를 돌려주는 함수 `x`의 선언"으로 해석된다. 변수가 아예 안 만들어진다. 경고 이름 `-Wvexing-parse`의 vexing은 "짜증나는"이라는 뜻인데, 이 파싱 규칙의 악명이 그대로 이름이 됐다. note가 처방까지 준다 — 괄호를 지우거나 중괄호로 바꿔라. `int x{};`는 **값 초기화(value initialization)** 로, 0으로 채워진 진짜 변수를 만든다. (직접 실측하면 `0`이 출력된다.)

### 이 책의 기준: 중괄호가 기본이다

정리하면 중괄호 초기화는 ① 축소 변환을 에러로 만들고 ② 함수 선언으로 오해받지 않으며 ③ 빈 `{}`로 0 초기화까지 된다. 그래서 **이 책의 코드는 중괄호 초기화를 기본으로 쓴다.** `=`는 `int i = 0;`처럼 의미가 명백한 단순 대입 형태에 한해 허용한다 — 기존 코드베이스의 지배적 스타일이라 읽기 훈련에도 필요하다.

단, 중괄호에도 예외 조항이 하나 있다. 컨테이너에서 `()`와 `{}`는 **완전히 다른 생성자를 부른다.**

```cpp title="vec.cpp — 괄호와 중괄호가 다른 생성자를 고른다"
#include <iostream>
#include <vector>

int main() {
    std::vector<int> a(3);   // 크기 3
    std::vector<int> b{3};   // 원소 3 하나
    std::cout << "a: size=" << a.size() << " ->";
    for (int v : a) std::cout << " " << v;
    std::cout << "\nb: size=" << b.size() << " ->";
    for (int v : b) std::cout << " " << v;
    std::cout << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra vec.cpp -o vec
$ ./vec
a: size=3 -> 0 0 0
b: size=1 -> 3
```

`(3)`은 "0으로 채운 원소 3개", `{3}`은 "값이 3인 원소 1개"다. 중괄호가 `initializer_list`(값 목록) 생성자를 우선 선택하기 때문인데, 그 선택 규칙과 내부 동작은 [5.1 vector: 내부 구조와 성장 전략](#/vector)에서 연다. 지금 기억할 것은 하나 — **컨테이너에 "개수"를 주려면 `()`, "내용물"을 주려면 `{}`.**

## 스코프와 수명은 다른 개념이다

변수가 태어났으니 이제 "어디까지 존재하는가"다. 여기서 많은 사람이 하나로 뭉뚱그리는 두 개념을 갈라야 한다.

- **스코프(scope)**: 그 이름이 **보이는** 소스 코드상의 구역. 컴파일 타임의 성질이고, 코드 텍스트 위에 그려진다.
- **수명(lifetime)**: 그 객체가 메모리에 **존재하는** 실행 시간 구간. 런타임의 성질이고, 시간 축 위에 그려진다.

보통의 지역 변수는 둘이 겹친다 — `{`에서 스코프가 열리며 객체가 태어나고, `}`에서 스코프가 닫히며 죽는다. 겹쳐 있으니 구분할 필요를 못 느낀다. 하지만 둘이 어긋나는 사례가 C++ 곳곳에 있고, 어긋나는 지점이 전부 버그 다발 지대다. 대표 사례 둘을 본다.

### 어긋남 1 — 이름 가리기(shadowing)

안쪽 블록에서 바깥과 같은 이름을 선언하면, 안쪽 이름이 바깥 이름을 **가린다.** 바깥 변수는 멀쩡히 살아 있는데(수명 유지) 이름으로 접근할 수 없게 된다(스코프 가림).

```cpp title="shadow.cpp — 5~9번 줄에서 바깥 error는 보이지 않는다" {6}
#include <iostream>

int main() {
    double error = 0.5;               // 바깥 error
    for (int i = 0; i < 3; ++i) {
        double error = 0.0;           // 안쪽 error: 바깥을 가린다
        error += 0.1;
        std::cout << error << "\n";
    }
    std::cout << "final: " << error << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra shadow.cpp -o shadow
$ ./shadow
0.1
0.1
0.1
final: 0.5
```

루프 안의 `error += 0.1`은 매번 새로 태어난 안쪽 변수에 더해진다. 바깥 `error`는 0.5 그대로다. 오차를 누적할 생각이었다면 이 코드는 조용히 틀렸다 — 컴파일도 실행도 멀쩡하니 더 위험하다. 그리고 실측이 보여주듯 **`-Wall -Wextra`는 가리기를 경고하지 않는다.** 별도 플래그 `-Wshadow`를 붙여야 잡힌다.

```console
$ g++ -std=c++20 -Wall -Wextra -Wshadow shadow.cpp -o shadow
shadow.cpp: In function 'int main()':
shadow.cpp:6:16: warning: declaration of 'error' shadows a previous local [-Wshadow]
    6 |         double error = 0.0;           // 안쪽 error: 바깥을 가린다
      |                ^~~~~
shadow.cpp:4:12: note: shadowed declaration is here
    4 |     double error = 0.5;               // 바깥 error
      |            ^~~~~
```

::: tip -Wshadow를 상비 플래그에 추가하라
가리기는 리팩터링 중에 잘 생긴다 — 긴 함수 일부를 블록으로 감싸다가, 멤버 변수와 같은 이름의 지역 변수를 만들다가. 이 책의 이후 실습 명령에는 `-Wshadow`가 기본으로 들어간다: `g++ -std=c++20 -Wall -Wextra -Wshadow ...`. 경고가 나면 억제하지 말고 **한쪽 이름을 바꿔라.** 같은 이름 두 개가 필요한 코드는 없다.
:::

### 어긋남 2 — static 지역 변수: 스코프는 좁고 수명은 길다

반대 방향의 어긋남도 있다. `static`을 붙인 지역 변수는 스코프는 함수 안에 갇혀 있지만, 수명은 프로그램 전체다.

```cpp title="lifetime.cpp"
#include <iostream>

void tick() {
    static int calls = 0;
    int local = 0;
    ++calls;
    ++local;
    std::cout << "calls=" << calls << " local=" << local << "\n";
}

int main() {
    tick();
    tick();
    tick();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lifetime.cpp -o lifetime
$ ./lifetime
calls=1 local=1
calls=2 local=1
calls=3 local=1
```

`local`은 호출마다 태어나고 죽으니 매번 1이다. `calls`는 첫 호출 때 **한 번만** 초기화되고, 함수가 반환돼도 죽지 않고, 다음 호출에서 그 값 그대로 이어진다. 두 변수를 시간 축에 그리면 차이가 보인다.

```text nolines
        call #1      call #2      call #3
local:  [born-die]   [born-die]   [born-die]
calls:  [init 0 ==================== alive until program exit]
```

`static` 지역 변수는 스택이 아니라 전역 변수와 같은 정적 영역에 산다([2.1](#/memory-model)에서 위치를 확인한다). 전역 변수와 다른 점은 딱 하나, **이름이 함수 밖에서 안 보인다**는 것 — 수명은 전역급인데 스코프는 지역이다. 스코프와 수명이 별개의 축이라는 것을 이보다 명확히 보여주는 물건이 없다.

::: note static 초기화는 스레드 안전하다
`static int calls = 0;`의 초기화는 C++11부터 "첫 도달 시 정확히 한 번"이 언어 차원에서 보장되고, 여러 스레드가 동시에 처음 도달해도 안전하다. 컴파일러가 초기화 여부 플래그와 잠금 코드를 심어 주기 때문인데, 그 비용과 내부 구조는 동시성을 배운 뒤에야 정확히 논할 수 있다. 지금은 "초기화는 한 번, 스레드 안전"만 기억하라.
:::

### 전역 변수를 피하는 이유

`static` 지역 변수의 사촌이 전역 변수다. 어디서든 보이고(전역 스코프) 프로그램 내내 산다(정적 수명). "어디서든 보인다"가 장점처럼 들리지만 실제로는 **어디서든 바뀔 수 있다**는 뜻이고, 그 순간 어떤 함수의 동작도 그 함수의 인자만 봐서는 예측할 수 없게 된다. 버그를 추적할 때 용의자가 코드베이스 전체로 늘어나고, 테스트는 전역 상태를 매번 리셋해야 하며, 스레드가 둘만 돼도 동시 접근 문제가 시작된다. 서로 다른 파일의 전역 변수끼리는 초기화 순서조차 보장되지 않는다 — 이 함정은 [1.10 네임스페이스와 링크리지](#/linkage)에서 정면으로 다룬다. 원칙: 값은 인자로 넘기고 결과는 반환으로 받아라. 전역으로 두고 싶은 유혹이 드는 값의 대부분은 아래에서 볼 "이름 붙인 상수"이거나, 클래스로 묶여야 할 상태다.

::: interview "스코프와 수명의 차이를 설명하라"
신입~주니어 C++ 면접의 단골이고, static 지역 변수가 단골 후속타다. 답변 뼈대: ① 스코프는 이름이 보이는 **코드상의 구역**(컴파일 타임), 수명은 객체가 존재하는 **실행 시간 구간**(런타임)이다. ② 보통 지역 변수는 둘이 일치하지만, 어긋나는 사례로 static 지역 변수(스코프는 함수 안, 수명은 프로그램 전체)와 가려진(shadowed) 변수(수명은 유지되는데 이름만 안 보임)를 든다. ③ 상급 마무리: "스코프가 끝나도 객체가 살아 있는 경우(힙 할당)와, 반대로 **객체는 죽었는데 참조가 남는 경우가 댕글링 포인터**다"까지 잇는다 — 면접관이 원하는 방향 전환이 정확히 이것이다.
:::

## const와 constexpr 첫 만남

지금까지는 "값을 어떻게 넣는가"였다. 마지막 결정은 "넣은 값이 바뀌는가"다. 안 바뀐다면 그 사실을 타입에 새겨라.

```cpp
const double gravity = 9.81;   // 이후 대입 시도는 컴파일 에러
```

`const`의 가치는 컴파일러 검사 이전에 **읽는 사람에게 주는 정보**다. `const`가 붙은 변수는 선언 지점의 값이 곧 영원한 값이므로, 코드를 읽을 때 추적할 "움직이는 부품"이 하나 줄어든다. 함수 하나에 변수가 열 개인데 여덟 개가 `const`라면, 버그는 나머지 둘 근처에 있다. 그래서 습관은 이렇다 — **일단 const로 선언하고, 컴파일러가 "여기서 수정한다"고 항의하는 것만 non-const로 푼다.** 반대 방향보다 훨씬 빠르다.

한 단계 더 강한 것이 `constexpr`다. `const`는 "실행 중에 안 바뀐다"까지만 약속하지만(초기값 자체는 실행 시점에 계산돼도 된다), `constexpr`는 **값이 컴파일 타임에 확정된다**고 약속한다. 배열 크기처럼 컴파일 타임 상수가 필요한 자리에 쓸 수 있고, 계산을 통째로 컴파일 타임으로 옮기는 문까지 열린다 — 그 문은 [4.6 constexpr와 컴파일 타임 계산](#/constexpr)에서 연다.

이 도구의 첫 용도는 **매직 넘버 퇴치**다. 로봇 제어 코드에서 실제로 쓰는 형태로 보자.

```cpp title="constants.cpp — 조각: 헥사포드 제어 코드의 상수 선언부"
constexpr int kNumLegs = 6;
constexpr int kJointsPerLeg = 3;
constexpr int kNumJoints = kNumLegs * kJointsPerLeg;   // 컴파일 타임에 18로 확정
constexpr double kControlPeriodSec = 0.004;            // 250 Hz 제어 주기
```

코드 중간에 맨몸으로 등장하는 `18`이나 `0.004`는 읽는 사람에게 아무것도 말해 주지 않고, 로봇 사양이 바뀌면 코드 전체에 흩어진 숫자를 사냥해야 한다. 이름 붙인 상수는 의미를 말하고, 수정 지점이 한 곳이며, `kNumJoints`처럼 파생값의 계산 근거까지 코드에 남는다. 제어 주기 상수는 이 책의 로봇 파트 전체에서 계속 만난다 — 주기 하나로 타이머 설정, 적분 스텝, 워치독 한계가 전부 파생되기 때문이다.

::: tip 상수 이름 규칙
이 책은 컴파일 타임 상수에 `k` 접두사(`kNumJoints`)를 쓴다. 구글 C++ 스타일 가이드에서 온 관례로, ROS 2 생태계 코드에서 자주 보게 된다. `NUM_JOINTS` 같은 전체 대문자는 전처리 매크로와 충돌 위험이 있어 피한다.
:::

## 수명의 끝을 낚아챌 수 있다면

이 절을 관통한 개념은 수명이다 — 변수는 태어나고, 정해진 지점에서 죽는다. 여기서 C++에서 가장 중요한 질문 하나를 던진다. **죽는 그 순간에 코드를 실행할 수 있다면 무엇이 가능해지는가?**

클래스에는 소멸자라는 함수가 있고, 객체의 수명이 끝나는 순간 자동으로 호출된다. 한 줄짜리 맛보기만 보자.

```cpp title="raii.cpp"
#include <iostream>

struct Scoped {
    ~Scoped() { std::cout << "destructor runs here\n"; }
};

int main() {
    {
        Scoped s;
        std::cout << "inside block\n";
    }                       // s 의 수명이 여기서 끝난다
    std::cout << "after block\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra raii.cpp -o raii
$ ./raii
inside block
destructor runs here
after block
```

`}`를 지나는 순간, 아무도 부르지 않았는데 소멸자가 실행됐다. 이 자리에 "파일 닫기", "락 해제", "모터 토크 차단"을 넣으면 — 자원 정리를 **잊는 것이 불가능한** 코드가 된다. 어떤 경로로 블록을 빠져나가든, 도중에 예외가 날아가든, 수명의 끝은 반드시 오고 소멸자는 반드시 불린다. 이 관용구의 이름이 RAII이고, C++ 프로그래밍 전체의 척추다. [2.5 RAII: 소멸자가 자원을 관리한다](#/raii)에서 본격적으로 세운다. 오늘은 씨앗만 심는다: **수명은 제약이 아니라 도구다.**

## 요약

- C++은 지역 변수를 초기화해 주지 않는다. 미초기화 읽기는 쓰레기값이 아니라 **미정의 동작**이다.
- `-Wall`은 미초기화의 일부만 잡고, `-Wmaybe-uninitialized`는 최적화를 켜야 작동하며, 못 잡는 경우(g++ 13.3의 `if` 단일 분기)도 실측으로 확인했다. **선언하는 줄에서 초기화하는 습관**이 유일한 보증이다.
- 초기화는 중괄호 `{}`가 기본이다: 축소 변환을 에러로 만들고(`int x{3.14}` 실측), 함수 선언 함정(`int x();`)이 없고, `{}`는 0 초기화다.
- 예외: 컨테이너에서 `(3)`은 개수, `{3}`은 내용물이다 — 실측 `size=3` vs `size=1`.
- 스코프는 이름이 보이는 코드 구역(컴파일 타임), 수명은 객체가 존재하는 시간 구간(런타임)이다. 가리기(`-Wshadow`로 잡는다)와 static 지역 변수(스코프 지역, 수명 전역)가 둘이 별개라는 증거다.
- 바뀌지 않는 값은 `const`, 컴파일 타임에 확정되는 값은 `constexpr` — 매직 넘버 대신 `kNumJoints` 같은 이름 붙인 상수를 쓴다.
- 수명이 끝나는 순간 소멸자가 자동 실행된다. 이것이 RAII의 씨앗이다.

::: quiz 연습문제
1~2번은 개념, 3번은 출력 예측, 4~5번은 네 컴퓨터에서 하는 실습이다.

1. 동료가 "이 코드는 몇 년째 잘 돌았고 출력도 항상 0이었다"며 미초기화 변수 읽기를 고치지 않으려 한다. 두 가지 근거로 반박하라. (힌트: 이 절의 실측 하나, 표준의 규정 하나)

2. `std::vector<double> joints(6);`과 `std::vector<double> joints{6};`은 각각 무엇을 만드는가? 헥사포드 다리 6개의 관절 각도를 담을 컨테이너로 옳은 쪽은?

3. 아래 코드의 출력을 예측하라. 그리고 `-Wall -Wextra`만으로 이 문제를 잡을 수 있는지 답하라.

   ```cpp
   #include <iostream>

   int main() {
       int total = 100;
       {
           int total = 0;
           total += 7;
       }
       std::cout << total << "\n";
       return 0;
   }
   ```

4. (실습) 3번 코드를 그대로 타이핑하고 `-Wall -Wextra -Wshadow`로 컴파일하라. 성공 기준: `[-Wshadow]` 경고와, 가려진 선언의 위치를 가리키는 `note:`가 나온다. 그다음 안쪽 변수 이름을 바꿔 경고를 없애라.

5. (실습) 호출될 때마다 "이번이 몇 번째 호출인지"를 반환하는 함수 `int call_count();`를 static 지역 변수로 구현하고, `main`에서 세 번 호출해 1, 2, 3이 출력되게 하라. 성공 기준: `g++ -std=c++20 -Wall -Wextra -Wshadow` 경고 0개로 컴파일되고 출력이 정확히 1, 2, 3이다. 그다음 `static`을 지우고 다시 실행해 출력이 어떻게 변하는지 확인하라.
:::

::: answer 해설
1. 근거 ①(실측): 이 절의 `uninit.cpp`는 같은 바이너리를 세 번 실행해 32766, 32765, 32767 — 세 번 다 다른 값이 나왔다. "항상 0"은 그 환경의 우연일 뿐이며, 컴파일러 버전·최적화 레벨·실행 환경이 바뀌는 순간 깨질 수 있다. 근거 ②(표준): 미초기화 읽기는 미정의 동작이라 "0이 나온다"는커녕 "어떤 값이라도 나온다"조차 보장이 없다 — 최적화가 해당 코드 경로를 삭제하거나 변형해도 표준 위반이 아니다. "잘 돌았다"는 UB의 안전 증명이 될 수 없다.
2. `joints(6)`은 0.0으로 채워진 원소 6개, `joints{6}`은 값이 6.0인 원소 1개다. 다리 6개의 관절 각도를 담으려면 `joints(6)`이 맞다. `{6}`을 쓰면 크기 1짜리 컨테이너가 되어, 두 번째 다리부터 범위 밖 접근이다.
3. 출력은 `100`이다. 안쪽 `total`이 바깥을 가려서 `+= 7`은 안쪽에만 적용됐고, 안쪽은 `}`에서 죽었다. 그리고 이 절의 실측대로 `-Wall -Wextra`는 가리기를 경고하지 않는다 — `-Wshadow`가 별도로 필요하다.
4. g++ 13.3 실측 기준으로 `declaration of 'total' shadows a previous local [-Wshadow]`와 `note: shadowed declaration is here`가 나온다. 이름을 바꾸면(예: `int subtotal = 0;`) 경고가 사라지고, 무엇보다 코드의 의도가 읽는 사람에게 드러난다.
5. 뼈대: 함수 안에 `static int count = 0;`을 두고 `++count; return count;`. `static`을 지우면 `count`가 호출마다 새로 태어나 매번 1이 반환된다 — `lifetime.cpp` 실측에서 `local`이 매번 1이었던 것과 같은 이유다. 이 대비를 직접 보는 것이 이 문제의 목적이다.
:::

읽기만 한 절은 남지 않는다. 지금 IDE에서 `uninit.cpp`(세 번 실행해 값이 바뀌는지), `narrow3.cpp`(에러 재현), `vec.cpp`, `shadow.cpp`(`-Wshadow` 유무 비교), `lifetime.cpp`를 전부 직접 치고 실행하라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -Wshadow 파일.cpp -o 이름 && ./이름`이다. 이 절부터 `-Wshadow`가 상비 플래그다.

**다음 절**: [1.4 캐스팅과 타입 변환](#/casting) — `int x = 3.14`가 조용히 통과한 이유인 암묵 변환의 전체 지도를 그리고, 의도를 명시하는 네 가지 캐스트를 배운다.
