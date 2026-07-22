# 0.2 컴파일러, CMake, 디버거 설치

::: lead
이 절에서 이 책 전체를 지탱할 도구를 설치한다 — 컴파일러(g++), 빌드 시스템(CMake), 디버거(gdb), 그리고 편집기(VSCode). 설치 자체는 명령 몇 줄이면 끝난다. 중요한 것은 그다음이다: **깔린 도구가 진짜로 C++20을 컴파일하는지, CMake가 빌드를 만들어내는지, gdb가 프로그램 속을 들여다보는지**를 직접 확인한다. 여기서 확인한 명령들이 앞으로 수백 번 반복될 당신의 기본 동작이 된다. 마지막에는 Part X를 위한 ROS 2 Humble Docker 환경까지 잡는다.
:::

## 무엇을 깔고, 왜 이 조합인가

설치할 것은 네 가지다.

| 도구 | 역할 | 이 책에서 깊게 다루는 곳 |
| --- | --- | --- |
| **g++** (GCC의 C++ 컴파일러) | 소스를 실행파일로 | [1.1 컴파일 모델](#/compile-model) |
| **gdb** | 실행 중인 프로그램의 내부 관찰 | [7.4 gdb로 디버깅하기](#/gdb) |
| **CMake** | 빌드 절차의 기술과 자동화 | [7.1 CMake 기초](#/cmake-basics) |
| **VSCode** | 편집기 + 위 셋의 조종석 | [0.4 학습 워크플로](#/workflow) |

넷의 관계는 이렇다. 컴파일 명령을 만들어 주는 것이 CMake, 그 명령을 실제로 수행하는 것이 g++, 그 결과물을 열어 보는 것이 gdb다. VSCode는 셋을 한 화면에서 부리는 자리다.

```text nolines
 main.cpp ---> [ g++ ] ---> app ---> [ gdb ]
                  ^
                  | build commands
              [ CMake ] <--- CMakeLists.txt
```

왜 clang이나 MSVC가 아니라 g++인가. 취향 문제가 아니라 **목적지가 정해 준 선택**이다. 이 책의 종착점인 ROS 2는 우분투를 1순위 플랫폼으로 삼고, 공식 바이너리가 GCC로 빌드되며, ROS 2의 빌드 도구인 colcon과 ament도 결국 내부에서 CMake와 GCC를 부른다([10.10 ament, colcon, 패키지 구조](#/ament-colcon)에서 이 관계를 해부한다). 지금 우분투에서 g++와 CMake에 손을 붙여 두면, Part X에서 만나는 ROS 2 빌드 시스템은 이미 아는 것의 포장일 뿐이다. clang은 뒤에서 정적 분석 도구(clang-tidy)로 합류하고, macOS 사용자의 주 컴파일러이기도 하다 — 아래 "다른 OS" 절에서 다룬다.

## 우분투에서 설치하기

이 책의 기준 환경은 **우분투 24.04 LTS**다. 설치는 세 패키지로 끝난다.

```console
$ sudo apt update
$ sudo apt install build-essential gdb cmake
```

::: note build-essential의 내용물
`build-essential`은 단일 프로그램이 아니라 메타패키지다. 안에 gcc, **g++**, make, 그리고 C 표준 라이브러리 헤더(libc6-dev)가 들어 있다. C++ 컴파일러만 필요해도 이 묶음으로 까는 이유가 있다 — 링크 단계에서 C 런타임과 시스템 헤더가 반드시 필요하고, 그게 빠진 환경에서 나는 에러는 초심자가 해석하기 가장 어려운 종류이기 때문이다.
:::

설치가 끝나면 세 도구의 버전을 확인한다. 이 확인 습관은 요식이 아니다 — 컴파일러 버전은 지원하는 C++ 표준과 에러 메시지의 생김새를 결정하고, 남에게 질문할 때 가장 먼저 밝혀야 할 정보다.

```console
$ g++ --version
g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
$ gdb --version
GNU gdb (Ubuntu 15.1-1ubuntu1~24.04.1) 15.1
$ cmake --version
cmake version 3.28.3
```

(Ubuntu 24.04 / g++ 13 기준 실측. 배포판에 따라 버전은 다르다.)

이 책의 최소선은 [0.1](#/how-to-read)에서 말한 대로 **g++ 13 이상**이다. g++ 13은 이 책이 쓰는 C++20 기능을 전부 지원한다.

::: warn 우분투 22.04를 쓰고 있다면
22.04의 기본 g++는 11이고, C++20 지원에 구멍이 있다. 세 가지 길이 있다: (1) 24.04로 올린다 — 가장 깔끔하다. (2) 아래 Docker 절의 방식으로 컨테이너 안에서 작업한다. (3) 별도 저장소에서 새 g++를 받는다 — 시스템 기본 컴파일러가 둘이 되는 상태를 스스로 관리할 수 있을 때만 권한다. 어느 쪽이든 `g++ --version`으로 13 이상을 확인하고 넘어가라.
:::

## C++20이 진짜 도는지 확인

버전 숫자를 봤다고 끝이 아니다. **C++20 코드를 실제로 컴파일해 본다.** 아래 코드는 C++20에서 새로 들어온 두 기능을 쓴다 — 멤버 이름을 지정하는 초기화(designated initializer)와, 템플릿 인자에 제약을 거는 콘셉트(concepts). 둘 다 뒤에서 제대로 배우니 지금은 "C++20에만 있는 문법"이라는 사실만 알면 된다.

```cpp title="check20.cpp"
#include <concepts>
#include <iostream>

struct JointState {
    double position;
    double velocity;
    double effort;
};

// C++20 concepts: 부동소수점 타입만 받는 함수
template <std::floating_point T>
T half(T v) { return v / 2; }

int main() {
    // C++20 designated initializer
    JointState js{ .position = 1.57, .velocity = 0.0, .effort = 3.2 };
    std::cout << "pos=" << js.position << " half=" << half(js.effort) << "\n";
    return 0;
}
```

`JointState`라는 이름이 낯설다면 기억해 둘 가치가 있다 — 관절 하나의 위치·속도·토크를 담는 이 세 필드 구조는 ROS 2의 관절 상태 메시지, 그리고 ros2_control이 하드웨어와 주고받는 인터페이스의 최소 단위와 같은 모양이다. 이 책의 예제는 이렇게 처음부터 로봇의 어휘로 쓴다.

컴파일하고 실행한다. `-std=c++20`이 핵심이다.

```console
$ g++ -std=c++20 -Wall -Wextra check20.cpp -o check20
$ ./check20
pos=1.57 half=1.6
```

(Ubuntu 24.04 / g++ 13.3 기준 실측.)

이 두 줄이 나왔다면 당신의 컴파일러는 이 책의 모든 코드를 받아들일 준비가 됐다.

::: warn -std=c++20은 항상 직접 붙여야 한다
g++ 13의 기본 표준은 C++20이 아니라 **C++17**(정확히는 GNU 확장이 섞인 gnu++17)이다. 플래그 없이 `g++ check20.cpp`만 치면 아래에서 볼 C++17 에러가 그대로 난다. "최신 컴파일러를 깔았으니 최신 표준이겠지"는 성립하지 않는다 — 기본값은 기존 코드의 호환성을 위해 보수적으로 잡혀 있다. CMake 프로젝트에서 이 플래그를 강제하는 방법은 [7.1](#/cmake-basics)에서 다룬다.
:::

### 일부러 틀려 보기: -std=c++17로 컴파일하면

같은 파일을 C++17로 컴파일하면 무슨 일이 생기는지 보자. 이 대비가 "표준 버전"이라는 개념을 몸에 새긴다.

```console
$ g++ -std=c++17 -Wall -Wextra check20.cpp -o check17
check20.cpp:11:11: error: 'std::floating_point' has not been declared
   11 | template <std::floating_point T>
      |           ^~~
check20.cpp:12:1: error: 'T' does not name a type
   12 | T half(T v) { return v / 2; }
      | ^
check20.cpp: In function 'int main()':
check20.cpp:17:55: error: 'half' was not declared in this scope
   17 |     std::cout << "pos=" << js.position << " half=" << half(js.effort) << "\n";
      |                                                       ^~~~
```

(g++ 13.3 기준 실측. 에러 메시지의 문구는 컴파일러 버전에 따라 다르다.)

읽는 법을 다음 절에서 훈련하겠지만, 지금도 구조는 보인다 — 첫 에러가 원인(`std::floating_point`는 C++17에 없다)이고, 나머지 둘은 그 여파다. 첫 에러부터 고치는 것이 철칙이다.

::: warn 조용히 통과하는 쪽이 더 위험하다
눈여겨볼 것: 에러 세 개가 전부 concepts에서 났고, **designated initializer에 대한 에러는 없다.** g++는 이 문법을 C++17 모드에서도 GNU 확장으로 조용히 받아 준다. `-Wpedantic`을 붙여야 실측으로 이런 경고가 나온다: `warning: C++ designated initializers only available with '-std=c++20' [-Wc++20-extensions]`. "내 컴퓨터에서 컴파일됐다"와 "표준 C++이다"는 다른 명제다 — 다른 컴파일러, 다른 팀, 다른 CI로 코드가 이동하는 순간 이 차이가 청구서가 되어 돌아온다.
:::

## CMake와 gdb 스모크 테스트

컴파일러가 확인됐으니 나머지 둘도 실전 형태로 한 번씩 굴려 본다. 문법 공부가 아니라 **설치 검증**이다 — 각 도구의 내용은 Part VII에서 제대로 다룬다.

먼저 CMake. 새 디렉터리에 두 파일을 만든다.

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.16)
project(hello CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(hello main.cpp)
```

```cpp title="main.cpp"
#include <iostream>
int main() { std::cout << "toolchain ok\n"; }
```

CMake의 사용은 두 단계다. **구성(configure)** — 컴파일러를 찾고 빌드 파일을 생성한다. **빌드(build)** — 생성된 빌드 파일로 실제 컴파일을 수행한다.

```console
$ cmake -B build -S .
-- Detecting CXX compile features - done
-- Configuring done (0.2s)
-- Generating done (0.0s)
-- Build files have been written to: .../hello/build
$ cmake --build build
[ 50%] Building CXX object CMakeFiles/hello.dir/main.cpp.o
[100%] Linking CXX executable hello
[100%] Built target hello
$ ./build/hello
toolchain ok
```

(cmake 3.28 / g++ 13 기준 실측. 구성 출력은 앞부분을 생략했다.)

빌드 출력의 두 줄에 주목하라 — `Building`(컴파일)과 `Linking`(링크)이 **별개의 단계**로 나온다. 이 구분이 [1.1 컴파일 모델](#/compile-model)의 주제이고, C++ 에러의 절반을 가르는 선이다.

다음은 gdb. 디버거로 열 프로그램은 `-g` 플래그로 컴파일해야 한다 — 실행파일 안에 소스 줄 번호와 변수 이름을 담는 옵션이다. 아까의 check20.cpp를 다시 쓴다.

```console
$ g++ -std=c++20 -g check20.cpp -o check20
$ gdb -q ./check20
(gdb) break main
Breakpoint 1 at 0x1176: file check20.cpp, line 16.
(gdb) run
Breakpoint 1, main () at check20.cpp:16
16	    JointState js{ .position = 1.57, .velocity = 0.0, .effort = 3.2 };
(gdb) print js
$1 = {position = 7.8726316228683315e-85, velocity = 2.1165311283480734e+214, effort = 6.9533558072160389e-310}
(gdb) quit
```

(gdb 15.1 기준 실측. `print js`의 값은 실행할 때마다 다르다.)

`break main`으로 중단점을 걸고 `run`으로 실행하면, 프로그램이 16번 줄 **직전에** 멈춘다. 그 상태에서 `print js`가 보여 주는 값을 보라 — `position`이 1.57이 아니라 `7.87e-85` 같은 난수다. 초기화 줄이 **아직 실행되지 않았기 때문에**, `js`가 차지한 스택 메모리에 이전부터 굴러다니던 쓰레기 비트가 그대로 읽힌 것이다. C++는 초기화하지 않은 변수를 0으로 만들어 주지 않는다. 이 사실이 만드는 버그의 전모는 Part II에서 다루지만, 디버거는 첫날부터 이렇게 언어의 맨살을 보여 준다.

::: tip 새니타이저까지 한 번에 확인
이 책의 실습 명령에는 `-fsanitize=address`가 자주 붙는다. 메모리 버그를 실행 시점에 잡아 주는 ASan이라는 도구인데([7.5](#/sanitizers)), 별도 설치가 필요 없다 — g++가 이미 품고 있다. `g++ -std=c++20 -g -fsanitize=address check20.cpp -o check20 && ./check20`이 정상 실행되면 그 확인도 끝난 것이다.
:::

## VSCode 세팅

편집기는 **VSCode + Microsoft의 C/C++ 확장(ms-vscode.cpptools)** 을 기준으로 한다. VSCode는 공식 사이트에서 우분투용 .deb 패키지를 받아 설치하고, 확장은 확장 탭에서 "C/C++"를 검색해 설치한다. 이 조합을 기준으로 삼는 이유는 하나다 — 코드 완성부터 gdb 연동 디버깅([7.4](#/gdb)에서 씀)까지 확장 하나로 끝나서, 도구 배관에 쓰는 시간이 가장 적다.

::: note clangd를 이미 쓰고 있다면
코드 완성 엔진으로 clangd를 선호하는 사람도 많고, 대형 코드베이스에서는 더 빠르기도 하다. 그대로 써도 이 책 진행에 아무 지장이 없다 — 이 책이 VSCode에 기대는 것은 "편집 + 터미널 + 디버거가 한 화면"이라는 배치뿐이고, 그 배치는 [0.4 학습 워크플로](#/workflow)에서 잡는다.
:::

단, 한 가지 원칙. **컴파일은 처음 몇 주간 IDE 버튼이 아니라 터미널에서 직접 명령으로 하라.** `g++ -std=c++20 -Wall -Wextra main.cpp` 를 손으로 치는 동안 플래그 하나하나가 의미로 남는다. 버튼 뒤에 숨은 빌드는 [1.1](#/compile-model)을 지난 뒤에 써도 늦지 않다.

## 다른 OS에서는

**Windows** — WSL2에 우분투 24.04를 깔고 그 안에서 위의 우분투 절차를 그대로 따르는 것을 권한다. 이유는 두 가지다. 첫째, ROS 2 실습(Part X)까지 같은 리눅스 환경을 유지할 수 있어 도구가 두 벌이 되지 않는다. 둘째, MSVC는 에러 메시지도 플래그 체계도 GCC와 달라서, 이 책의 실측 출력과 당신의 화면이 계속 어긋난다. VSCode는 WSL 확장으로 WSL2 안의 코드를 네이티브처럼 편집한다.

**macOS** — Xcode Command Line Tools의 `g++`는 이름만 g++고 실체는 Apple clang이다. 문제는 버전 표기다: Apple clang의 버전 번호는 LLVM 본가의 번호와 **다른 체계**라, "clang 16 이상"이라는 이 책의 기준과 직접 비교할 수 없고, C++20 지원에 빈 구석이 있는 버전이 흔하다. Homebrew로 LLVM 본가(`brew install llvm`)나 GCC(`brew install gcc`)를 설치하고 버전을 확인한 뒤 쓰라. 이 책의 리눅스 실측 출력과 세부가 다를 수 있다는 점은 감안해야 한다.

두 경우 모두 이 책은 출력을 싣지 않는다 — 리눅스 실측만 싣는 것이 이 책의 원칙이고, 당신 화면의 출력이 곧 당신 환경의 진실이다.

## ROS 2 Humble 실습 환경 — Docker

마지막 조각이다. Part X부터 쓰는 ROS 2 Humble은 **우분투 22.04를 기준 플랫폼으로 배포**되므로, 지금 세운 24.04 호스트에 그대로 설치할 수 없다. Docker가 이 판을 깔끔하게 정리한다 — 22.04 + ROS 2가 통째로 들어 있는 이미지를 컨테이너로 띄우면, 호스트에는 아무것도 설치하지 않고 격리된 실습 환경을 얻는다. 로봇 현장에서도 이 방식이 표준에 가깝다: 배포 대상 로봇과 개발 PC의 OS가 다른 상황이 기본값이라, ROS 2 개발 환경은 컨테이너로 고정해 두는 팀이 많다.

Docker 자체는 배포판 문서에 따라 설치했다고 가정하고, ROS 2 이미지를 받는 명령은 이렇다.

```console
$ docker pull osrf/ros:humble-desktop
```

::: note 이미지 태그 고르기
`ros:humble`은 통신·빌드 핵심만 담은 공식 슬림 이미지고, `osrf/ros:humble-desktop`은 거기에 RViz 같은 시각화 도구까지 얹은 것이다. 이 책의 실습에는 desktop을 권한다 — 용량을 아끼려다 Part X에서 도구가 없어 다시 받는 일이 흔하다.
:::

컨테이너를 띄울 때는 작업 디렉터리를 호스트와 공유해 두는 것이 요령이다. 컨테이너 안에서 편집한 코드가 호스트에도 남는다.

```console
$ mkdir -p ~/ros2_ws
$ docker run -it --name ros2 -v ~/ros2_ws:/ros2_ws osrf/ros:humble-desktop
```

`-v 호스트경로:컨테이너경로`가 그 공유 옵션이다. 셸이 뜨면 `ros2 --help`가 동작하는지 확인해 보라.

::: tip 컨테이너는 지워져도 되는 존재로 다뤄라
`-v`로 공유한 디렉터리에만 작업물을 두면, 컨테이너는 언제든 지우고(`docker rm ros2`) 새로 띄울 수 있는 소모품이 된다. "환경이 꼬이면 갈아엎는다"가 Docker를 쓰는 이유의 절반이다 — 컨테이너 안에서만 존재하는 파일에 애착을 갖는 순간 그 장점이 사라진다.
:::

지금은 이미지를 받아 셸이 뜨는 것까지만 확인하면 된다. GUI 연결, 워크스페이스 구성, colcon 빌드는 Part X 진입 시점에 [10.10 ament, colcon, 패키지 구조](#/ament-colcon)와 함께 단계적으로 세운다.

## 요약

- 이 책의 도구 사슬은 **g++ 13+ / gdb / CMake / VSCode**, 기준 OS는 우분투 24.04다. 이 조합은 ROS 2 생태계의 표준 경로와 일치한다 — colcon/ament도 결국 CMake와 GCC를 부른다.
- 설치는 `sudo apt install build-essential gdb cmake` 한 줄, 검증은 `--version` 세 번이다. 버전은 지원 표준과 에러 메시지를 결정하는 핵심 정보다.
- g++ 13의 기본 표준은 C++17이다. **모든 컴파일에 `-std=c++20`을 직접 붙인다.**
- "컴파일된다"와 "표준 C++이다"는 다르다 — GNU 확장은 조용히 통과한다. `-Wall -Wextra`를 습관으로 붙이고, 이식성이 걱정되면 `-Wpedantic`도 단다.
- CMake는 구성(`cmake -B build`)과 빌드(`cmake --build build`)의 2단계, gdb는 `-g`로 컴파일한 실행파일을 연다. 깊은 내용은 Part VII에서.
- ROS 2 Humble은 우분투 22.04 기준이므로 **Docker 컨테이너**(`osrf/ros:humble-desktop`)로 격리해 준비한다. 작업물은 `-v`로 공유한 디렉터리에만 둔다.

::: quiz 연습문제
1. `g++ check20.cpp`처럼 `-std` 플래그 없이 컴파일하면 어떤 표준이 적용되는가? 그 상태에서 check20.cpp의 두 C++20 기능(concepts, designated initializer) 중 에러가 나는 것은 어느 쪽이고, 왜 다른 쪽은 통과하는가?
2. `cmake --build build`의 출력에서 `Building CXX object`와 `Linking CXX executable`은 왜 별개의 줄로 나오는가? 각 단계에서 실패하면 어떤 종류의 에러가 나는지, [0.1](#/how-to-read)의 "컴파일은 통과하고 링크에서 실패한다" 예제와 연결해 설명해 보라.
3. **[코드 작성]** check20.cpp를 복사하지 말고 직접 타이핑해서, `g++ -std=c++20 -Wall -Wextra check20.cpp -o check20 && ./check20`이 경고 없이 통과하고 `pos=1.57 half=1.6`이 나오면 성공이다. 타이핑 중 에러가 나면 지우지 말고 메시지를 한 줄씩 읽어 보라 — 그 연습이 [0.3](#/first-build)의 예습이다.
4. **[코드 작성]** 위의 hello 프로젝트(CMakeLists.txt + main.cpp)를 직접 만들어 구성→빌드→실행까지 통과시켜라. 그다음 main.cpp의 세미콜론 하나를 일부러 지우고 `cmake --build build`를 다시 실행해, 에러 메시지에 파일명과 줄 번호가 어떻게 찍히는지 확인하라.
:::

::: answer 1번 해설
플래그가 없으면 g++ 13은 gnu++17(GNU 확장이 섞인 C++17)로 컴파일한다. concepts는 C++17에 존재하지 않는 문법이라 `'std::floating_point' has not been declared` 에러가 난다. 반면 designated initializer는 표준 C++17에는 없지만 g++가 GNU 확장으로 받아 주기 때문에 조용히 통과한다 — `-Wpedantic`을 붙여야 경고가 된다. "에러가 안 났다"가 "표준에 맞다"를 뜻하지 않는 대표적인 사례다.
:::

**다음 절**: [0.3 첫 빌드와 에러 메시지 읽는 법](#/first-build) — 방금 깐 도구로 첫 프로그램을 빌드하고, 컴파일러가 뱉는 텍스트를 정보로 바꾸는 훈련을 시작한다.
