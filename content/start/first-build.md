# 0.3 첫 빌드와 에러 메시지 읽는 법

::: lead
[0.2](#/toolchain-setup)에서 도구를 세웠으니 이제 첫 프로그램을 빌드한다. 그런데 이 절의 진짜 주제는 hello world가 아니다. **멀쩡한 프로그램을 일부러 네 번 깨뜨리고, 컴파일러가 뱉는 텍스트를 정보로 바꿔 읽는 훈련**이다. C++ 개발자는 하루에도 수십 번 에러 메시지를 만난다. 그 붉은 글자를 소음으로 넘기는 사람과 한 줄씩 해부해서 읽는 사람은 성장 속도가 완전히 다르다. 여기서 30분을 쓰면 앞으로 몇 년 치 디버깅 시간이 줄어든다.
:::

## 첫 프로그램

에디터를 열고 아래를 **직접 타이핑한다.** 복사 버튼을 누르지 마라 — [0.1](#/how-to-read)에서 약속한 대로, 오타가 만들어 주는 에러가 오늘의 교재다.

```cpp title="hello.cpp"
#include <iostream>

int main() {
    std::cout << "hello, robot\n";
    return 0;
}
```

빌드 명령은 이것이다. 이 책 전체에서 계속 쓸 형태이니 손에 붙여 두라.

```console
$ g++ -std=c++20 -Wall -Wextra hello.cpp -o hello
$ ./hello
hello, robot
```

명령을 조각내면 이렇다.

| 조각 | 뜻 |
| --- | --- |
| `g++` | GNU C++ 컴파일러 드라이버. 전처리 → 컴파일 → 링크 전 과정을 지휘한다 |
| `-std=c++20` | 언어 표준. 이 책의 기준이다 |
| `-Wall -Wextra` | 경고를 켠다. **항상 붙인다** — 이유는 아래 '경고는 공짜 코드 리뷰'에서 |
| `hello.cpp` | 입력 소스 파일 |
| `-o hello` | 출력 실행파일 이름. 생략하면 `a.out`이라는 무성의한 이름이 된다 |

첫 명령이 **아무것도 출력하지 않고** 프롬프트로 돌아왔다는 것에 주목하라. 유닉스 도구의 관례다 — 침묵이 성공이다. 컴파일러가 말을 걸어오는 순간은 문제가 있을 때뿐이고, 그래서 컴파일러의 말은 전부 읽을 가치가 있다.

## 일부러 깨뜨린다

이제 방금 성공한 프로그램을 체계적으로 부순다. 각 깨뜨리기는 같은 리듬으로 진행한다: **어떤 에러가 날지 먼저 예측하고 → 깨뜨리고 → 컴파일하고 → 메시지를 끝까지 읽고 → 복원한다.** 예측이 틀리는 순간이 가장 크게 배우는 순간이다.

이 절의 모든 컴파일러 출력은 실측이다. (g++ 13 기준 실측. 버전에 따라 문구는 조금씩 다르다.)

::: note 에러 메시지는 표준이 아니다
C++ 표준은 "진단 메시지를 내라"고만 요구할 뿐 문구는 컴파일러 마음이다. 같은 실수라도 g++와 clang은 다르게 말하고, g++ 12와 13도 조금 다르다. 그래서 **문구를 외우는 게 아니라 구조를 읽는 법**을 익혀야 한다. 이 절이 그 훈련이다.
:::

### 깨뜨리기 1 — 세미콜론을 지운다

`hello.cpp` 4번 줄 끝의 `;`를 지우고 다시 컴파일한다.

```console
$ g++ -std=c++20 -Wall -Wextra hello.cpp -o hello
hello.cpp: In function 'int main()':
hello.cpp:4:34: error: expected ';' before 'return'
    4 |     std::cout << "hello, robot\n"
      |                                  ^
      |                                  ;
    5 |     return 0;
      |     ~~~~~~
```

읽어 보자. `hello.cpp:4:34`는 **파일:줄:칸**이다 — 4번 줄 34번째 칸, 즉 문자열이 끝난 직후를 가리킨다. `^`가 그 지점을 찍고, 그 아래 `;`는 "여기에 이걸 넣으라"는 수정 제안이다. 그런데 메시지를 보면 `before 'return'` — 컴파일러는 5번 줄의 `return`을 언급하고 있다.

왜 그런가. **세미콜론이 빠진 순간에는 컴파일러도 빠졌다는 것을 모른다.** C++에서 문장은 여러 줄에 걸칠 수 있으므로, 4번 줄이 끝나도 문장이 계속되는 중일 수 있다. 컴파일러는 다음 토큰인 `return`을 읽고 나서야 "문장이 안 끝났는데 새 문장이 시작됐다"는 것을 알아챈다. 그래서 에러가 보고되는 위치는 실수한 위치가 아니라 **컴파일러가 실수를 알아챈 위치**다.

::: warn 에러 줄 번호는 '발견 지점'이지 '원인 지점'이 아니다
에러가 가리키는 줄에서 문제를 못 찾겠으면 **그 줄보다 앞을 보라.** 특히 `expected ';'`, `expected '}'` 류는 거의 항상 원인이 앞 줄(또는 훨씬 위)에 있다. 헤더 파일 끝에서 세미콜론을 빠뜨리면 그 헤더를 include한 **다른 파일**의 첫 줄이 에러로 지목되기도 한다. 이 성질을 모르면 멀쩡한 줄을 30분 동안 노려보게 된다.
:::

`;`를 복원하고 컴파일이 침묵하는 것까지 확인한 뒤 다음으로 간다.

### 깨뜨리기 2 — #include 를 지운다

이번엔 1번 줄 `#include <iostream>`을 통째로 지운다.

```console
$ g++ -std=c++20 -Wall -Wextra hello.cpp -o hello
hello.cpp: In function 'int main()':
hello.cpp:2:10: error: 'cout' is not a member of 'std'
    2 |     std::cout << "hello, robot\n";
      |          ^~~~
hello.cpp:1:1: note: 'std::cout' is defined in header '<iostream>'; did you forget to '#include <iostream>'?
  +++ |+#include <iostream>
    1 | int main() {
```

`'cout' is not a member of 'std'` — `std`라는 네임스페이스에 `cout`이라는 이름이 없다는 뜻이다. `<iostream>`을 include하지 않으면 `std::cout`의 선언 자체가 이 파일에 존재하지 않으므로, 컴파일러 입장에서 그 이름은 세상에 없는 것이다. include가 왜 "선언을 가져오는" 행위인지는 [1.9 헤더와 컴파일 단위](#/headers)에서 해부한다.

여기서 진짜 볼거리는 두 번째 덩어리, `note:`로 시작하는 부분이다. g++가 원인 진단을 넘어 **해법을 통째로 알려주고 있다** — 어느 헤더에 정의돼 있는지, 뭘 잊었는지, 심지어 `+++ |+#include <iostream>` 줄은 "1번 줄 위에 이 줄을 추가하라"는 패치 형식의 제안이다.

::: tip note 줄까지 읽어야 절반을 읽은 것이다
많은 초심자가 `error:` 줄만 읽고 스크롤을 멈춘다. 최신 g++와 clang은 진단의 뒷부분(`note:`)에 원인 후보, 관련 선언의 위치, 수정 제안을 붙여 준다. **답의 절반은 note에 있다.** 에러 하나를 읽을 때는 다음 `error:`가 나오기 전까지의 덩어리 전체가 한 세트다.
:::

### 깨뜨리기 3 — 이름을 틀리게 친다

이번엔 새 파일이다. 센서값을 읽는 척하는 작은 프로그램을 치되, **호출부에서 함수 이름을 일부러 틀리게** 친다.

```cpp title="sensor.cpp — 8번 줄에 오타가 있다" {8}
#include <iostream>

double read_sensor() {
    return 0.42;
}

int main() {
    std::cout << read_senor() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sensor.cpp -o sensor
sensor.cpp: In function 'int main()':
sensor.cpp:8:18: error: 'read_senor' was not declared in this scope; did you mean 'read_sensor'?
    8 |     std::cout << read_senor() << "\n";
      |                  ^~~~~~~~~~
      |                  read_sensor
```

`was not declared in this scope` — 이 스코프에 그런 이름이 선언된 적 없다는 뜻이고, 이어서 `did you mean 'read_sensor'?`라고 정답을 짚어 준다. 컴파일러는 현재 스코프에서 보이는 이름들과 틀린 이름 사이의 **편집 거리**(몇 글자를 고치면 같아지는가)를 재서, 충분히 가까운 후보가 있으면 제안한다. 오타 에러는 대부분 이 제안 한 줄로 끝난다. 오타를 고치고 실행하면 `0.42`가 나온다.

### 깨뜨리기 4 — 정의를 지운다

이제 이 절에서 가장 중요한 깨뜨리기다. `sensor.cpp`에서 `read_sensor`의 **몸체를 지우고 선언만 남긴다.**

```cpp title="sensor.cpp — 정의가 사라졌다" {3}
#include <iostream>

double read_sensor();   // 선언은 남겼다

int main() {
    std::cout << read_sensor() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sensor.cpp -o sensor
/usr/bin/ld: /tmp/ccmdzIpp.o: in function `main':
sensor.cpp:(.text+0x9): undefined reference to `read_sensor()'
collect2: error: ld returned 1 exit status
```

출력의 생김새가 지금까지와 **완전히 다르다.** 나란히 놓고 보라.

```text nolines
compile error:
  hello.cpp:4:34: error: expected ';' before 'return'
  ^^^^^^^^^^^^^^ file:line:col -- source position

linker error:
  /usr/bin/ld: ... undefined reference to `read_sensor()'
  ^^^^^^^^^^^ speaker is ld, not g++ -- no line number
```

첫 토큰이 소스 파일명이 아니라 `/usr/bin/ld`다. **말하고 있는 주체가 컴파일러가 아니라 링커(linker)다.** 컴파일 단계는 이미 통과했다 — 선언이 있으니 컴파일러는 "`read_sensor`라는 함수가 어딘가에 있다"고 믿고 호출 코드를 만들어 줬다. 그 "어딘가"를 실제로 찾아 연결하는 것이 링커의 일인데, 어떤 파일에도 몸체가 없으니 `undefined reference`(정의되지 않은 참조)로 실패한 것이다.

줄 번호가 없는 것도 우연이 아니다. `sensor.cpp:(.text+0x9)`는 "오브젝트 파일 코드 영역의 9바이트 지점"이라는 뜻이다 — 링커는 소스 코드가 아니라 **컴파일이 끝난 기계어 덩어리**를 다루기 때문에, 소스의 몇 번째 줄인지 알지 못한다.

`undefined reference`를 보면 "문법이 틀렸나?"가 아니라 **"약속한 정의를 아무도 제공하지 않았다 — 어느 파일(라이브러리)을 빼먹었나?"**로 읽어야 한다. 이 구분은 [1.1 컴파일 모델](#/compile-model)의 주제이고, 아래 '파일이 두 개가 되면'에서 바로 다시 만난다.

::: deep collect2는 누구인가
마지막 줄 `collect2: error: ld returned 1 exit status`의 `collect2`는 g++가 링크 단계에서 부르는 내부 래퍼 프로그램이다. 전역 객체의 생성자 호출 정보를 모으는(collect) 등의 뒤처리를 한 뒤 진짜 링커 `ld`를 실행한다. 즉 이 줄은 "내가 시킨 ld가 실패 코드 1을 돌려줬다"는 보고이고, 진짜 정보는 그 위의 `undefined reference` 줄에 있다. `collect2` 줄 자체에는 원인이 없으니 시선을 위로 올려라.
:::

::: interview 컴파일 에러 vs 링커 에러
"컴파일은 되는데 링크가 안 되는 경우를 설명해 보라"는 C++ 면접의 단골 첫 질문이다. 모범 답변의 뼈대: ① 컴파일러는 번역 단위 하나씩 처리하며 **선언만 있으면** 호출 코드를 생성할 수 있다. ② 링커는 모든 오브젝트 파일과 라이브러리를 모아 **정의를 실제로 연결**하는 단계이고, 정의가 없으면 `undefined reference`, 정의가 여러 개면 multiple definition으로 실패한다. ③ 그래서 라이브러리를 링크 목록에서 빠뜨린 것이 전형적 원인이다. 여기에 [1.10 링크리지](#/linkage)의 ODR까지 얹어 말하면 상급이다.
:::

## 에러 메시지 해부학

네 번의 깨뜨리기에서 본 것을 일반 형식으로 정리한다. g++ 진단 한 덩어리의 구조는 이렇다.

```text nolines
file:line:col: kind: message      <- where / how bad / what
   NN | source line               <- the line, quoted
      |      ^~~~~~               <- caret + underline: exact span
      |      fix                  <- (optional) suggested fix
```

`kind` 자리에는 세 종류가 온다. 셋의 무게가 다르다.

| 종류 | 뜻 | 빌드 |
| --- | --- | --- |
| `error` | 규칙 위반. 코드를 만들 수 없다 | 실패한다 |
| `warning` | 합법이지만 수상하다. 버그일 확률이 높은 패턴 | **통과한다** |
| `note` | 에러/경고에 붙는 부가 정보 — 원인 위치, 수정 제안 | 해당 없음 |

`note`는 독립적인 문제가 아니라 직전 `error`나 `warning`의 각주다. "에러가 몇 개 났나"를 셀 때 note는 세지 않는다.

### 연쇄 에러: 첫 에러만 고치고 재컴파일하라

에러가 화면을 가득 채우면 초심자는 "내가 뭘 얼마나 잘못했길래"라고 얼어붙는다. 실측으로 확인해 보자. `<vector>` include 하나를 빠뜨린 파일이다.

```cpp title="ids.cpp — 빠진 것은 #include <vector> 하나다"
#include <iostream>

int main() {
    std::vector<int> ids = {1, 2, 3};
    ids.push_back(4);
    for (int id : ids) {
        std::cout << id << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra ids.cpp -o ids
ids.cpp: In function 'int main()':
ids.cpp:4:10: error: 'vector' is not a member of 'std'
    4 |     std::vector<int> ids = {1, 2, 3};
      |          ^~~~~~
ids.cpp:2:1: note: 'std::vector' is defined in header '<vector>'; did you forget to '#include <vector>'?
    1 | #include <iostream>
  +++ |+#include <vector>
    2 |
ids.cpp:4:17: error: expected primary-expression before 'int'
    4 |     std::vector<int> ids = {1, 2, 3};
      |                 ^~~
ids.cpp:5:5: error: 'ids' was not declared in this scope
    5 |     ids.push_back(4);
      |     ^~~
```

실수는 하나인데 에러는 세 개다. 도미노다. ① `std::vector`라는 이름이 없다(진짜 원인). ② 그러면 컴파일러는 `vector<int>`를 타입으로 읽지 못하고 `vector < int`라는 비교식으로 해석을 시도하다 실패한다. ③ 그 결과 선언문 전체가 무효가 되어 변수 `ids` 자체가 존재하지 않게 되고, 다음 줄부터 `ids`를 쓰는 곳마다 에러가 난다.

②와 ③은 ①이 만든 유령이다. 고치려 들면 안 되는 에러다. 그래서 원칙은 하나다.

::: tip 첫 에러만 고치고, 재컴파일하라
컴파일러 출력에서 **첫 번째 `error:`** 를 찾아 그것만 고치고 다시 컴파일한다. 나머지 에러의 대부분은 첫 에러가 파생시킨 유령이라 저절로 사라진다. 에러 50개가 떠도 실제 실수는 한두 개인 경우가 흔하다. 출력이 길어 첫 에러가 스크롤 위로 사라지면 `g++ ... 2>&1 | head -30`으로 앞부분만 잘라 보라. 템플릿이 얽히면 에러 하나가 수백 줄이 되는데, 그 해독법은 [4.3 템플릿 인스턴스화의 실체](#/template-mechanics)에서 따로 다룬다.
:::

::: note colcon 로그도 결국 같은 형식이다
나중에 ROS 2 패키지를 `colcon build`로 빌드하면 수십 개 패키지의 로그가 쏟아진다. 겁먹을 것 없다 — colcon은 각 패키지 안에서 CMake를 돌리고, CMake는 결국 g++를 돌린다. 실패한 패키지의 로그를 열면 그 안에 있는 것은 **오늘 배운 `파일:줄:칸: error:` 형식 그대로**다. 첫 에러를 찾아 파일:줄로 이동하는 오늘의 훈련이 [10.10 ament, colcon, 패키지 구조](#/ament-colcon)에서 그대로 통한다.
:::

## 경고는 공짜 코드 리뷰

이번엔 에러가 아니라 경고다. 아래 프로그램은 **문법적으로 완전히 합법**이고, 컴파일도 실행도 된다.

```cpp title="warn.cpp — 합법이지만 수상한 코드"
#include <iostream>
#include <vector>

int main() {
    int retry_count = 3;
    std::vector<double> joints = {0.1, 0.2, 0.3};
    for (int i = 0; i < joints.size(); ++i) {
        std::cout << joints[i] << "\n";
    }
    return 0;
}
```

경고 플래그 없이 컴파일하면 컴파일러는 침묵한다.

```console
$ g++ -std=c++20 warn.cpp -o warn
$ ./warn
0.1
0.2
0.3
```

`-Wall -Wextra`를 붙이면 같은 코드에서 이런 말이 나온다.

```console
$ g++ -std=c++20 -Wall -Wextra warn.cpp -o warn
warn.cpp: In function 'int main()':
warn.cpp:7:23: warning: comparison of integer expressions of different signedness: 'int' and 'std::vector<double>::size_type' {aka 'long unsigned int'} [-Wsign-compare]
    7 |     for (int i = 0; i < joints.size(); ++i) {
      |                     ~~^~~~~~~~~~~~~~~
warn.cpp:5:9: warning: unused variable 'retry_count' [-Wunused-variable]
    5 |     int retry_count = 3;
      |         ^~~~~~~~~~~
```

두 경고를 읽어 보자. 끝의 대괄호(`[-Wsign-compare]`, `[-Wunused-variable]`)는 이 경고를 켠 플래그 이름이다 — 경고의 종류를 검색하거나 개별 제어할 때 쓰는 정확한 이름이 여기 있다.

**`-Wunused-variable`**: `retry_count`는 선언만 되고 한 번도 쓰이지 않았다. 무해해 보이지만, 실전에서 이 경고는 "쓰려던 변수 대신 다른 변수를 썼다"거나 "리팩터링하다 로직을 지웠다"는 신호인 경우가 많다. 죽은 코드는 읽는 사람을 속인다.

**`-Wsign-compare`**: `i`는 부호 있는 `int`인데 `joints.size()`는 부호 없는 정수(`size_type`)다. 부호가 다른 두 정수를 비교하면 C++은 조용히 한쪽을 변환하는데, 이 변환이 음수를 거대한 양수로 바꿔 버릴 수 있다. 왜 그런 일이 생기는지는 [1.2 타입 시스템](#/types)에서 정수 표현을 다루며 파헤친다.

::: danger 부호 없는 정수 역순 루프 — 진짜 사고가 나는 지점
sign-compare 계열의 실수가 실제로 터지는 전형은 역순 루프다. 아래는 조각 코드다.

```cpp
// ❌ i 는 unsigned: 0에서 --i 를 하면 음수가 아니라 거대한 양수로 감긴다
for (std::size_t i = joints.size() - 1; i >= 0; --i) { /* ... */ }
```

`i >= 0`은 부호 없는 타입에서 **항상 참**이므로 루프가 끝나지 않고, `i`가 0 아래로 감기는 순간 배열 밖을 읽는다. 컨테이너가 비어 있으면 `size() - 1`부터 이미 거대한 양수다. 이런 코드가 로봇 관절 배열을 도는 제어 코드에 들어가면 세그폴트로 끝나면 운이 좋은 것이다. `-Wall -Wextra`는 이 계열의 실수 상당수를 커밋 전에 잡아 준다.
:::

경고의 무서운 점은 **빌드가 통과한다**는 것이다. 에러는 무시할 수 없지만 경고는 무시할 수 있고, 무시하다 보면 쌓이고, 쌓이면 아무도 안 읽는다. 그 더미 속에 진짜 버그의 예고가 묻힌다. 그래서 이 책의 기준은 명확하다. **이 책의 모든 코드는 `-Wall -Wextra`에서 경고 0개다.** 당신의 코드도 그래야 한다. 경고는 컴파일러가 무료로 해 주는 코드 리뷰이고, 리뷰를 무시하는 습관은 나중에 고치기 어렵다.

::: hist -Wall은 왜 기본값이 아닌가
`-Wall`은 "all warnings"라는 이름과 달리 전부를 켜지 않는다. 이 이름이 붙은 뒤 수십 년간 새 경고가 계속 추가됐는데, 기존 코드베이스의 빌드 로그를 갑자기 경고로 뒤덮지 않으려고 상당수를 `-Wall` 밖에 뒀다. 그렇게 밀려난 유용한 경고들을 모은 것이 `-Wextra`(옛 이름은 그냥 `-W`)다. 기본값이 침묵인 것도 같은 이유다 — g++는 반세기 전 C 코드도 컴파일해야 하는 도구라서, 엄격함은 옵트인이다. 새로 시작하는 코드가 `-Wall -Wextra`를 안 켤 이유는 없다.
:::

## 파일이 두 개가 되면

실전 프로젝트는 파일 하나가 아니다. 함수를 다른 파일로 분리하는 최소 사례를 만들어 보자.

```cpp title="add.cpp"
int add(int a, int b) {
    return a + b;
}
```

```cpp title="main.cpp"
#include <iostream>

int add(int a, int b);   // add.cpp 에 정의가 있다고 약속한다

int main() {
    std::cout << add(2, 3) << "\n";
    return 0;
}
```

`main.cpp` 3번 줄의 선언은 **약속**이다. "이 서명의 함수가 어딘가에 정의돼 있으니, 일단 호출 코드를 만들어 달라." 컴파일러는 약속을 믿고, 약속의 이행 여부는 링커가 검사한다. 두 파일을 같이 주면 링커가 `add`의 정의를 `add.cpp` 쪽에서 찾아 연결한다.

```console
$ g++ -std=c++20 -Wall -Wextra main.cpp add.cpp -o calc
$ ./calc
5
```

`main.cpp`만 주면? 예측해 보라. 깨뜨리기 4에서 본 그 에러다.

```console
$ g++ -std=c++20 -Wall -Wextra main.cpp -o calc
/usr/bin/ld: /tmp/cc9ATveL.o: in function `main':
main.cpp:(.text+0x13): undefined reference to `add(int, int)'
collect2: error: ld returned 1 exit status
```

이제 이 메시지가 읽힌다. 문법 문제가 아니다 — `add`의 정의가 든 파일을 링크 목록에서 빠뜨렸다는 뜻이고, 처방은 `add.cpp`를 명령에 추가하는 것이다.

한 걸음 더. 컴파일과 링크를 **명시적으로 분리**할 수도 있다. `-c`는 "컴파일만 하고 링크는 하지 마라"는 뜻이고, 결과물은 `.o`(오브젝트 파일)다.

```console
$ g++ -std=c++20 -Wall -Wextra -c main.cpp
$ g++ -std=c++20 -Wall -Wextra -c add.cpp
$ g++ main.o add.o -o calc
$ ./calc
5
```

```text nolines
main.cpp --(compile -c)--> main.o --+
                                    +--(link)--> calc
add.cpp  --(compile -c)--> add.o ---+
```

왜 이런 번거로운 짓을 하는가. **바뀐 파일만 다시 컴파일하기 위해서다.** `main.cpp`만 고쳤다면 `add.o`는 그대로 두고 `main.cpp`만 재컴파일한 뒤 링크만 다시 하면 된다. 파일이 수백 개인 프로젝트에서 이 차이는 "3초 vs 20분"이다. 각 단계에서 정확히 무슨 일이 일어나는지 — 전처리가 무엇을 지우고, 오브젝트 파일 안에 무엇이 들어 있고, 링커가 심볼을 어떻게 맞춰 보는지 — 는 [1.1 컴파일 모델](#/compile-model)에서 전부 연다.

## CMake: 지금은 3줄만 외운다

파일이 늘수록 `g++` 명령은 길어지고, "바뀐 것만 다시 컴파일"을 손으로 관리하는 것은 불가능해진다. 그 일을 대신하는 표준 도구가 CMake다. 최소 예제는 3줄이다.

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.16)
project(hello)
add_executable(hello hello.cpp)
```

`hello.cpp`와 같은 디렉터리에 이 파일을 만들고, 두 명령을 실행한다.

```console
$ cmake -B build
-- The CXX compiler identification is GNU 13.3.0
...
-- Configuring done (0.4s)
-- Generating done (0.0s)
-- Build files have been written to: .../build
$ cmake --build build
[ 50%] Building CXX object CMakeFiles/hello.dir/hello.cpp.o
[100%] Linking CXX executable hello
[100%] Built target hello
$ ./build/hello
hello, robot
```

출력에서 익숙한 단어를 찾아보라 — `Building CXX object`(컴파일, `.o` 생성)와 `Linking CXX executable`(링크). CMake는 마법이 아니라 방금 손으로 한 `-c`와 링크를 대신 해 주는 관리자다. 빌드 산출물은 전부 `build/` 디렉터리 안에 격리되므로 소스 트리가 더러워지지 않고, 다시 빌드하면 바뀐 파일만 컴파일된다.

`cmake -B build`(구성)와 `cmake --build build`(빌드) 두 명령은 **지금은 이유를 묻지 말고 외워서 쓴다.** 타겟이 무엇이고 프로퍼티가 어떻게 전파되는지는 [7.1 CMake 기초](#/cmake-basics)에서 제대로 이해한다. ROS 2의 빌드 도구 colcon도 결국 패키지마다 이 CMake를 돌려 주는 바깥 껍데기다.

## 요약

- 빌드 명령의 기준형은 `g++ -std=c++20 -Wall -Wextra 파일.cpp -o 이름`이다. 침묵이 성공이다.
- 에러 위치 `파일:줄:칸`은 **발견 지점**이다. 원인은 그보다 앞에 있을 수 있다 — 특히 `expected ';'` 류.
- 진단은 `error`(빌드 실패) / `warning`(통과하지만 수상) / `note`(각주: 원인·수정 제안)의 세 종류다. note까지가 한 세트다.
- 연쇄 에러는 도미노다. **첫 에러만 고치고 재컴파일하라.**
- `undefined reference`는 링커(`ld`) 에러다. 문법이 아니라 "정의가 든 파일·라이브러리를 빠뜨렸다"로 읽는다.
- 경고는 공짜 코드 리뷰다. 이 책의 모든 코드는 `-Wall -Wextra` 경고 0개가 기준이고, 당신 코드도 그래야 한다.
- CMake 최소형: 3줄 `CMakeLists.txt` + `cmake -B build` + `cmake --build build`. 이해는 7.1에서.

::: quiz 연습문제
1번과 2번은 에러 메시지를 읽는 문제, 3번은 개념 문제, 4번과 5번은 **직접 깨뜨려 보는 실습**이다. 실습의 성공 기준은 "네 컴퓨터에서 같은 종류의 에러가 나는가"다.

1. 아래 실측 출력을 보라. 컴파일러는 6번 줄을 가리키지만 6번 줄은 멀쩡하다. 원인은 어디에 있고, 무엇인가?

   ```console
   $ g++ -std=c++20 -Wall -Wextra greet.cpp -o greet
   greet.cpp: In function 'int main()':
   greet.cpp:6:5: error: expected ',' or ';' before 'std'
       6 |     std::cout << name << "\n";
         |     ^~~
   ```

2. 아래 실측 출력은 어느 단계(컴파일/링크)의 실패인가? 근거가 되는 단서 두 가지를 대고, 처방을 말하라.

   ```console
   $ g++ -std=c++20 -Wall -Wextra motor.cpp -o motor
   /usr/bin/ld: /tmp/ccaABA6D.o: in function `main':
   motor.cpp:(.text+0xe): undefined reference to `clamp_pwm(int)'
   collect2: error: ld returned 1 exit status
   ```

3. 컴파일러 출력에 `error` 12개가 떴다. 왜 12개를 순서대로 다 고치려 들면 안 되는가? 올바른 절차는 무엇인가?

4. (실습) `hello.cpp`에서 마지막 줄의 닫는 중괄호 `}`를 지우고 컴파일하라. 어떤 에러가 나는지 예측한 뒤 실행하고, 에러에 붙은 `note:`가 무엇을 가리키는지 확인하라. 성공 기준: `expected '}'` 계열의 에러가 재현된다.

5. (실습) `hello.cpp`에서 문자열의 닫는 따옴표 `"`를 지우고 컴파일하라. 이번에는 같은 지점에 대해 `warning`과 `error`가 **둘 다** 나온다. 그다음, 이 절의 깨뜨리기 1~4를 처음부터 다시 재현하면서 각각이 컴파일 단계 에러인지 링크 단계 에러인지 소리 내어 분류하라. 성공 기준: 네 개 모두 같은 종류의 에러가 나고, 링크 에러는 하나뿐임을 확인한다.
:::

::: answer 해설
1. 원인은 **5번 줄 끝의 세미콜론 누락**이다(`std::string name = "hexpider"` 뒤). 문장이 끝나지 않았음을 컴파일러는 6번 줄 첫 토큰 `std`를 보고서야 알았고, 그래서 발견 지점인 6:5가 보고됐다. `expected ';'` 류는 지목된 줄의 **앞**을 본다 — 깨뜨리기 1의 원칙 그대로다.
2. **링크 단계**다. 단서: ① 말하는 주체가 `/usr/bin/ld`이고 마지막 줄이 `collect2: error: ld returned ...`다. ② 위치가 `파일:줄:칸`이 아니라 `(.text+0xe)` — 링커는 소스 줄을 모른다. 처방: `clamp_pwm`의 **정의**를 작성하거나, 정의가 들어 있는 `.cpp`/라이브러리를 링크 명령에 추가한다.
3. 첫 에러가 파싱을 무너뜨리면 뒤따르는 에러 대부분은 파생된 유령이기 때문이다(`ids.cpp`에서 실수 1개가 에러 3개를 만든 것처럼). 절차: **첫 `error:` 하나만 고치고 재컴파일** — 남은 에러 수가 급감하는 것을 확인하고 반복한다.
4. g++ 13 실측으로는 `error: expected '}' at end of input`이 나오고, `note: to match this '{'`가 **짝이 안 맞는 여는 중괄호**(`int main() {`)의 위치를 가리킨다. 중괄호 짝 에러에서 note는 "어느 `{`가 닫히지 않았나"를 알려주는 핵심 단서다.
5. 따옴표 실습의 실측은 `warning: missing terminating " character`와 같은 문구의 `error`가 연달아 나온다(전처리 시점과 컴파일 시점이 각각 문제를 보고한다). 분류: 깨뜨리기 1(세미콜론)·2(include)·3(오타)은 컴파일 단계, **깨뜨리기 4(정의 없음)만 링크 단계**다. 이 구분이 자동으로 나오면 이 절의 목표는 달성이다.
:::

이 절은 읽기만 하면 남는 게 없다. 지금 IDE 터미널에서 `hello.cpp`부터 `CMakeLists.txt`까지 전부 직접 치고, 네 번의 깨뜨리기를 전부 재현하라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra hello.cpp -o hello && ./hello`다.

**다음 절**: [0.4 학습 워크플로: 앱과 IDE의 병행](#/workflow) — 이 앱과 IDE를 어떻게 배치하고 어떤 리듬으로 오갈지, 복습 루틴까지 잡는다.
