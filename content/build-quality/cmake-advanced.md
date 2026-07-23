# 7.2 CMake 심화

::: lead
7.1은 타겟 하나, 소스 파일 몇 개로 CMake의 기본 문법을 익혔다. 그런데 실제 프로젝트는 남의 코드를 가져다 쓴다 — Eigen으로 행렬을 돌리고, 스레드를 쓰려고 pthread를 링크하고, 가끔은 apt에도 rosdep에도 없는 작은 헤더 전용 라이브러리를 빌드 타임에 통째로 받아 온다. 그리고 그 반대 방향도 있다 — 내가 만든 라이브러리를 다른 패키지가 `find_package()`로 찾아 쓰게 만들어야 한다. 여기에 더해 로봇 소프트웨어 특유의 문제 하나가 얹힌다. 개발 머신은 x86-64인데 로봇에 실제로 올라가는 보드는 ARM이다 — 그 보드 위에서 직접 컴파일하는 건 너무 느리거나 아예 불가능하다. 이 절은 이 네 가지 문제 — 외부 라이브러리 찾기, 빌드 타임 다운로드, 내 라이브러리 배포하기, 다른 아키텍처용으로 빌드하기 — 를 전부 실제로 돌려서 확인한다. 마지막으로 빌드 타입(Debug/Release)이 실제로 어떤 컴파일 플래그로 번역되는지도 눈으로 본다.
:::

## find_package: 시스템에 이미 설치된 라이브러리를 찾는다

`#include <Eigen/Dense>`를 쓰려면 컴파일러가 헤더를 찾을 경로를 알아야 하고, `std::thread`를 실제로 돌리려면 링커가 pthread 구현을 찾아야 한다. 7.1의 방식대로라면 `target_include_directories(demo PRIVATE /usr/include/eigen3)`처럼 경로를 하드코딩해야 하는데, 이 경로는 배포판마다, 설치 방법마다 다르다. `find_package()`는 이 문제를 "경로를 하드코딩하지 말고, 시스템에게 물어봐라"로 바꾼다.

```cmake title="CMakeLists.txt — find_package + IMPORTED 타겟"
cmake_minimum_required(VERSION 3.16)
project(find_pkg_demo CXX)

find_package(Eigen3 REQUIRED)
find_package(Threads REQUIRED)

add_executable(demo main.cpp)
target_link_libraries(demo PRIVATE Eigen3::Eigen Threads::Threads)
target_compile_features(demo PRIVATE cxx_std_20)
```

이 환경(Ubuntu 24.04, `libeigen3-dev` 3.4.0-4build0.1)에서 실제로 구성한 결과다.

```console
$ cmake ..
-- The CXX compiler identification is GNU 13.3.0
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD - Success
-- Found Threads: TRUE
-- Configuring done (0.4s)
-- Generating done (0.0s)
```

Eigen3에 대해서는 "Found" 메시지가 안 찍혔는데도 구성이 성공했다 — 여기가 `find_package()`의 동작 방식을 정확히 이해해야 하는 지점이다. `--debug-find-pkg=Eigen3`로 실제 탐색 과정을 들여다보면 이유가 나온다.

```console
$ cmake .. --debug-find-pkg=Eigen3
  find_package considered the following paths for FindEigen3.cmake:
    /usr/share/cmake-3.28/Modules/FindEigen3.cmake
  The file was not found.
  find_package considered the following locations for Eigen3's Config module:
    ...
    /usr/share/eigen3/cmake/Eigen3Config.cmake
  The file was found at
    /usr/share/eigen3/cmake/Eigen3Config.cmake
```

`find_package()`는 두 가지 모드로 동작한다. **Module 모드**는 CMake 자신이 들고 있는 `FindXxx.cmake` 스크립트를 쓴다 — 이 스크립트가 라이브러리를 직접 뒤지고, 대개 `find_package_handle_standard_args()`로 "Found Threads: TRUE" 같은 표준화된 메시지를 찍는다(위 출력의 `Threads`가 이 경로다). **Config 모드**는 라이브러리 자신이 설치할 때 함께 심어 둔 `<Package>Config.cmake` 파일을 그대로 `include()`한다 — Eigen3는 CMake 표준 Module을 안 쓰고 자체 Config 파일(`Eigen3Config.cmake`)을 제공하므로, CMake는 Module을 찾다 실패하면 곧바로 Config 모드로 넘어간다. Config 파일 안에 무슨 메시지를 찍을지는 그 라이브러리 제작자 마음이라서, Eigen처럼 아무것도 안 찍는 경우도 흔하다 — **메시지가 없다고 실패한 게 아니다**, 설정 자체가 에러 없이 끝났으면 성공이다.

실제 컴파일 명령을 뽑아 보면 `Eigen3::Eigen`이라는 타겟 하나가 실제로 무엇을 대신해 주는지 보인다.

```console
$ cmake --build . -- VERBOSE=1
/usr/bin/c++  -isystem /usr/include/eigen3 -std=gnu++20 ... -c main.cpp
/usr/bin/c++ CMakeFiles/demo.dir/main.cpp.o -o demo
$ ./demo
thread ok
2 0 0
0 2 0
0 0 2
```

`-isystem /usr/include/eigen3`가 자동으로 붙었다 — 이 경로를 어디에도 직접 안 썼는데도 나왔다. `Eigen3::Eigen`은 **IMPORTED 타겟**이다 — 헤더 경로, 컴파일 옵션, 필요하면 링크할 라이브러리까지 전부 타겟의 프로퍼티로 캡슐화한 값이다. `target_link_libraries()`에 이 타겟 하나만 적으면 그 프로퍼티들이 전이적으로(transitively) `demo`에 전파된다 — 7.1의 PUBLIC/PRIVATE 전파 규칙이 남의 라이브러리에도 그대로 적용되는 것이다. 링크 줄에는 `-lpthread`가 안 보이는데, glibc 2.34 이후로는 pthread 함수가 `libc` 안에 통합돼서 별도 링크가 필요 없어졌기 때문이다 — `Threads::Threads`가 이 사실까지 알아서 처리해 준다. 하드코딩된 `-lpthread`를 여기저기 흩어 놓았다면 이 변화에 프로젝트 전체를 일일이 손봐야 했을 것이다.

::: note
`find_package(X REQUIRED)`의 `REQUIRED`는 못 찾으면 그 자리에서 `cmake` 구성을 에러로 중단시킨다. 선택적 의존성이면 `REQUIRED`를 빼고 `if(X_FOUND)`로 분기한다.
:::

## FetchContent: 빌드 타임에 외부 코드를 통째로 받아온다

`find_package()`는 "이미 시스템 어딘가에 설치돼 있다"를 전제로 한다. 그런데 apt에도 rosdep에도 없는 작은 헤더 전용 라이브러리를 쓰고 싶을 때가 있다. `FetchContent`는 지정한 소스(대개 Git 저장소)를 구성(configure) 시점에 내려받아 마치 `add_subdirectory()`로 얹은 것처럼 프로젝트에 편입시킨다. 실제로 작은 헤더 전용 테스트 프레임워크 `doctest`를 이 환경에서 내려받아 빌드했다 — 이 환경은 실제로 네트워크에 접근할 수 있었고(`curl`로 `github.com` 확인 완료), 추측이 아니라 실제 다운로드·빌드·실행까지 전부 확인한 결과다.

```cmake title="CMakeLists.txt — FetchContent"
cmake_minimum_required(VERSION 3.16)
project(fetchcontent_demo CXX)

include(FetchContent)
FetchContent_Declare(
  doctest
  GIT_REPOSITORY https://github.com/doctest/doctest.git
  GIT_TAG        v2.4.11
)
FetchContent_MakeAvailable(doctest)

add_executable(demo main.cpp)
target_link_libraries(demo PRIVATE doctest::doctest)
target_compile_features(demo PRIVATE cxx_std_20)
```

```cpp title="main.cpp"
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>

int add(int a, int b) { return a + b; }

TEST_CASE("add works") {
    CHECK(add(2, 3) == 5);
}
```

```console
$ cmake ..
CMake Deprecation Warning at build/_deps/doctest-src/CMakeLists.txt:1 (cmake_minimum_required):
  Compatibility with CMake < 3.5 will be removed from a future version of CMake.
-- Configuring done (5.4s)
$ cmake --build .
[ 50%] Building CXX object CMakeFiles/demo.dir/main.cpp.o
[100%] Linking CXX executable demo
$ ./demo
[doctest] doctest version is "2.4.11"
===============================================================================
[doctest] test cases: 1 | 1 passed | 0 failed | 0 skipped
[doctest] assertions: 1 | 1 passed | 0 failed |
[doctest] Status: SUCCESS!
```

(g++ 13.3.0 / cmake 3.28.3 / Ubuntu 24.04 실측. 첫 `cmake ..` 실행 시 5.4초가 걸린 건 그 시간 동안 실제로 저장소를 clone했기 때문이다 — 캐시된 두 번째 구성부터는 즉시 끝난다.) 저장소가 통째로 어디에 내려받아지는지도 확인했다.

```console
$ ls build/_deps/
doctest-build  doctest-src  doctest-subbuild
$ du -sh build/_deps/doctest-src
13M    build/_deps/doctest-src
```

`FetchContent_Declare()`는 "이 이름으로, 이 위치에서, 이 버전을 가져오겠다"는 선언일 뿐이고, 실제 clone과 `add_subdirectory()` 편입은 `FetchContent_MakeAvailable()`이 한다. `_deps/<name>-src`가 받아온 원본, `_deps/<name>-build`가 그 하위 프로젝트의 빌드 산출물, `_deps/<name>-subbuild`가 다운로드 과정 자체를 처리하는 내부 스텁 프로젝트다. `doctest`의 `CMakeLists.txt`가 오래된 `cmake_minimum_required(VERSION 2.8)`를 써서 경고가 하나 나왔는데, 이건 우리 프로젝트의 문제가 아니라 받아온 남의 코드가 낸 경고다 — 그대로 실었다, 실제로 이런 게 섞여 나온다는 걸 보여주려고.

::: warn
`FetchContent`는 빌드할 때마다(정확히는 첫 구성 시, 그리고 `GIT_TAG`가 바뀌면) 네트워크가 있어야 한다. 이 성질이 `rosdep`/`apt`로 의존성을 미리 깔아 두는 ROS 2 패키지 관행과 충돌한다 — colcon 워크스페이스를 오프라인 빌드 환경(CI, 로봇 온보드)에서 굴려야 한다면 `FetchContent`보다 `rosdep`으로 시스템에 미리 설치해 두는 쪽이 안전하다. 어느 쪽이 맞는지는 [7.3 vcpkg와 Conan](#/package-managers)에서 더 다룬다.
:::

`find_package()`를 먼저 시도하고 실패할 때만 `FetchContent`로 넘어가는 패턴도 흔하다 — `find_package(doctest QUIET)` 다음에 `if(NOT doctest_FOUND)`로 감싸는 식이다. 시스템에 이미 있으면 그걸 쓰고, 없을 때만 내려받는 것이다.

## 설치와 export: 내 라이브러리를 find_package로 찾게 만든다

지금까지는 남이 만든 걸 찾아 썼다. 반대 방향 — 내가 만든 라이브러리를 다른 프로젝트가 `find_package(hexleg REQUIRED)`로 찾게 만드는 것 — 도 실제로 해 본다. 헥사포드 다리 하나의 전체 길이를 계산하는 아주 작은 정적 라이브러리를 만들고 설치까지 해 봤다.

```cmake title="hexleg/CMakeLists.txt — 설치 가능한 라이브러리"
cmake_minimum_required(VERSION 3.16)
project(hexleg VERSION 1.0.0 LANGUAGES CXX)

add_library(hexleg STATIC src/hexleg.cpp)
target_include_directories(hexleg PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(hexleg PUBLIC cxx_std_20)

include(CMakePackageConfigHelpers)
install(TARGETS hexleg EXPORT hexlegTargets ARCHIVE DESTINATION lib)
install(DIRECTORY include/ DESTINATION include)
install(EXPORT hexlegTargets FILE hexlegTargets.cmake
        NAMESPACE hexleg:: DESTINATION lib/cmake/hexleg)

configure_package_config_file(
  hexlegConfig.cmake.in ${CMAKE_CURRENT_BINARY_DIR}/hexlegConfig.cmake
  INSTALL_DESTINATION lib/cmake/hexleg)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/hexlegConfig.cmake
        DESTINATION lib/cmake/hexleg)
```

여기서 처음 보는 문법이 `$<BUILD_INTERFACE:...>`와 `$<INSTALL_INTERFACE:...>`다 — 이것도 아래 §의 제너레이터 표현식이다. 빌드 트리 안에서 이 타겟을 쓸 때(`BUILD_INTERFACE`)와, `install` 이후 다른 곳에 배포됐을 때(`INSTALL_INTERFACE`) 헤더 경로가 다르다는 걸 한 줄에 표현한다. 실제로 구성·빌드·설치까지 실행한 결과다.

```console
$ cmake --install .
-- Installing: .../installed/lib/libhexleg.a
-- Installing: .../installed/include/hexleg/hexleg.hpp
-- Installing: .../installed/lib/cmake/hexleg/hexlegTargets.cmake
-- Installing: .../installed/lib/cmake/hexleg/hexlegConfig.cmake
```

그리고 완전히 별도의 프로젝트에서 `CMAKE_PREFIX_PATH`로 이 설치 위치를 가리키기만 하면 `find_package(hexleg REQUIRED)`가 그대로 통한다.

```cmake title="consumer/CMakeLists.txt"
find_package(hexleg REQUIRED)
add_executable(consumer main.cpp)
target_link_libraries(consumer PRIVATE hexleg::hexleg)
```

```console
$ cmake .. -DCMAKE_PREFIX_PATH=/.../installed
-- Configuring done (0.3s)
$ cmake --build . && ./consumer
0.25
```

(coxa 0.05 + femur 0.08 + tibia 0.12 = 0.25 — `hexleg::leg_length()`가 실제로 설치된 라이브러리에서 호출된 결과다.) 이 소비자 쪽 코드는 위 `find_package(Eigen3 REQUIRED)`와 문법이 완전히 똑같다 — Eigen을 쓸 때와 내가 만든 라이브러리를 쓸 때 소비자 입장에서 아무 차이가 없다는 게 이 export 메커니즘의 핵심 목적이다. `hexleg::` 네임스페이스 접두사는 강제는 아니지만 관용구다 — 나중에 어디선가 `hexleg`라는 이름의 변수나 다른 타겟과 부딪혀도, `hexleg::hexleg`는 반드시 "import된 패키지의 타겟"이라는 게 이름만 봐도 드러난다.

## 빌드 타입: Debug/Release/RelWithDebInfo가 실제로 다른 컴파일러 플래그다

`CMAKE_BUILD_TYPE`은 겉보기엔 문자열 하나지만, 실제로는 컴파일러에 넘어가는 플래그 세트를 통째로 바꾼다. 말로 설명하지 않고 `VERBOSE=1`로 실제 컴파일 명령을 네 가지 값 각각에 대해 뽑았다 — 소스는 전부 동일한 `main.cpp` 하나다.

```console
$ cmake .. -DCMAKE_BUILD_TYPE=Debug   && cmake --build . -- VERBOSE=1 | grep 'c++ .*main'
/usr/bin/c++ -g -std=gnu++20 -fsanitize=address -fno-omit-frame-pointer ... -c main.cpp

$ cmake .. -DCMAKE_BUILD_TYPE=Release && cmake --build . -- VERBOSE=1 | grep 'c++ .*main'
/usr/bin/c++ -O3 -DNDEBUG -std=gnu++20 ... -c main.cpp

$ cmake .. -DCMAKE_BUILD_TYPE=RelWithDebInfo && cmake --build . -- VERBOSE=1 | grep 'c++ .*main'
/usr/bin/c++ -O2 -g -DNDEBUG -std=gnu++20 ... -c main.cpp

$ cmake ..                            && cmake --build . -- VERBOSE=1 | grep 'c++ .*main'
/usr/bin/c++ -std=gnu++20 ... -c main.cpp
```

(g++ 13.3.0 / cmake 3.28.3 실측. `-fsanitize=address` 등 ASan 플래그는 이 예제가 Debug 전용 generator expression으로 직접 추가한 것이고, 나머지 `-g`/`-O3`/`-DNDEBUG`/`-O2`는 CMake가 빌드 타입에 맞춰 자동으로 넣은 값이다.) 두 가지가 흔히 아는 것과 다르다는 걸 실측이 보여준다. 첫째, **Release의 기본 최적화는 `-O2`가 아니라 `-O3`이다** — "릴리스는 -O2"라는 통설은 이 버전의 CMake 기본값과 다르다. `-O3`는 `-O2`보다 더 공격적인 루프 벡터화·인라이닝을 켜는데, 항상 더 빠른 건 아니고 코드 크기가 늘어 캐시에 불리해지는 경우도 있다 — [8.3 컴파일러 최적화와 코드 생성](#/codegen)에서 이 차이를 실제로 벤치마크한다. 둘째, **`CMAKE_BUILD_TYPE`을 아예 지정하지 않으면 CMake는 최적화도 디버그 정보도 전혀 안 붙인다** — `-O0`조차 명시적으로 넣지 않는다(컴파일러 기본값이 사실상 `-O0`인 것뿐이다). 실전에서 흔한 사고가 여기서 난다 — `CMAKE_BUILD_TYPE`을 깜빡 지정 안 한 채로 "왜 이렇게 느리지"를 붙잡고 씨름하는 경우다.

`-DNDEBUG`는 `<cassert>`의 `assert()` 매크로를 통째로 지운다 — Release/RelWithDebInfo 빌드에서는 `assert(ptr != nullptr)` 같은 코드가 실행조차 안 된다는 뜻이다. [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 다룬 새니타이저 빌드는 이 표에서 반드시 Debug(또는 최소한 `-DNDEBUG` 없는) 설정으로 돌려야 한다 — Release로 새니타이저를 켜면 `assert`가 지워진 채로 최적화까지 겹쳐서 진단이 왜곡된다.

## generator expression: 빌드 타입별로 다른 옵션을 조건부로 건다

위 ASan 플래그를 Debug에만 붙인 방법이 `if(CMAKE_BUILD_TYPE STREQUAL "Debug")`가 아니라 `$<CONFIG:Debug>`였다는 걸 눈치챘을 것이다.

```cmake title="generator expression으로 Debug 전용 플래그"
target_compile_options(demo PRIVATE
  $<$<CONFIG:Debug>:-fsanitize=address -fno-omit-frame-pointer>)
target_link_options(demo PRIVATE
  $<$<CONFIG:Debug>:-fsanitize=address>)
```

`if(CMAKE_BUILD_TYPE STREQUAL "Debug")`도 이 프로젝트에서 쓴 Unix Makefiles 제너레이터에서는 똑같이 동작한다 — 위 실측 결과가 그 증거다. 그런데 이 방식은 **단일 설정(single-config) 제너레이터에서만** 통한다. Visual Studio나 Ninja Multi-Config 같은 **다중 설정(multi-config) 제너레이터**는 `cmake ..`로 구성할 때 빌드 타입을 하나로 고정하지 않는다 — Debug/Release 둘 다를 같은 빌드 트리 안에 만들어 두고, 실제 타입은 `cmake --build . --config Debug`처럼 빌드 시점에 고른다. 이런 제너레이터에서는 구성 시점에 도는 `if(CMAKE_BUILD_TYPE STREQUAL ...)`가 아무 의미가 없다 — 그 시점엔 아직 어떤 설정으로 빌드할지 정해지지 않았기 때문이다. `$<CONFIG:Debug>` 같은 **제너레이터 표현식**은 구성 시점이 아니라 **빌드 파일을 실제로 찍어내는(generate) 시점**에, 그것도 설정별로 따로 평가된다 — 그래서 두 제너레이터 종류 모두에서 통하는 유일한 방법이다. 이 프로젝트는 Unix Makefiles라 `if()`로도 됐지만, 습관을 제너레이터 표현식으로 들이는 이유가 바로 이식성이다.

## 크로스 컴파일: 로봇이 개발 머신과 다른 아키텍처일 때

::: perf
지금까지 쓴 x86-64 개발 머신에서의 컴파일은 몇 초에서 몇십 초다. 그런데 헥사포드처럼 Raspberry Pi나 Jetson 같은 ARM 보드가 최종 타겟이라면, 그 보드 위에서 직접 같은 코드를 컴파일하면 훨씬 오래 걸린다 — 클럭이 낮고 코어 수도 적기 때문이다. ROS 2 패키지 하나가 아니라 워크스페이스 전체를 그 보드 위에서 매번 다시 빌드하는 건 현실적이지 않다.
:::

**크로스 컴파일**은 이 문제를 "빌드는 빠른 개발 머신에서, 실행은 느린 타겟 보드에서"로 가른다. 개발 머신에 타겟 아키텍처용 크로스 컴파일러(`aarch64-linux-gnu-g++` 같은)를 설치하고, CMake에게 "이번엔 네가 지금 돌고 있는 머신이 아니라 이 컴파일러로, 이 시스템을 타겟으로 빌드해라"라고 알려주는 파일이 **툴체인 파일**이다.

```cmake title="toolchain-aarch64.cmake"
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)

set(CMAKE_C_COMPILER   aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)

# 타겟 아키텍처의 헤더/라이브러리를 찾을 때만 이 루트 아래를 본다
set(CMAKE_FIND_ROOT_PATH /usr/aarch64-linux-gnu)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

`cmake -DCMAKE_TOOLCHAIN_FILE=toolchain-aarch64.cmake ..`로 구성하면, `CMAKE_SYSTEM_NAME`이 현재 실행 중인 OS와 달라지는 순간 CMake는 이 구성을 크로스 컴파일로 인식하고 위 컴파일러들을 쓴다. `CMAKE_FIND_ROOT_PATH_MODE_PROGRAM`을 `NEVER`로 둔 이유가 중요하다 — `protoc`처럼 빌드 중에 **개발 머신에서 실행돼야 하는 프로그램**은 타겟 루트 밑에서 찾으면 안 되고(ARM 바이너리를 x86 머신에서 실행할 수 없다), 반대로 라이브러리·헤더는 반드시 타겟 루트(`ONLY`) 밑에서만 찾아야 한다 — x86용 헤더를 잘못 잡으면 컴파일은 되는데 ABI가 안 맞는 바이너리가 나온다.

이 환경에는 처음에 ARM 크로스 컴파일러가 없었다. `apt-get install -y g++-aarch64-linux-gnu`(Ubuntu 24.04 저장소의 `13.3.0-6ubuntu2~24.04.1cross1`)로 실제 설치한 뒤, 위 툴체인 파일로 실제로 구성·빌드했다.

```console
$ aarch64-linux-gnu-g++ --version
aarch64-linux-gnu-g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0

$ cmake .. -DCMAKE_TOOLCHAIN_FILE=../toolchain-aarch64.cmake
-- The CXX compiler identification is GNU 13.3.0
-- Check for working CXX compiler: /usr/bin/aarch64-linux-gnu-g++ - skipped
-- Configuring done (0.3s)

$ cmake --build . -- VERBOSE=1
/usr/bin/aarch64-linux-gnu-g++ -std=gnu++20 ... -c main.cpp
/usr/bin/aarch64-linux-gnu-g++ CMakeFiles/demo.dir/main.cpp.o -o demo

$ file demo
demo: ELF 64-bit LSB pie executable, ARM aarch64, ... dynamically linked, interpreter /lib/ld-linux-aarch64.so.1, ...

$ ./demo
bash: ./demo: cannot execute binary file: Exec format error
```

(g++/aarch64-linux-gnu-g++ 13.3.0, cmake 3.28.3, Ubuntu 24.04 x86-64 호스트 실측.) `CMakeLists.txt`는 툴체인 파일을 넣기 전과 완전히 똑같은데도 `-DCMAKE_TOOLCHAIN_FILE`을 넘긴 것만으로 실제 컴파일러가 `c++`에서 `aarch64-linux-gnu-g++`로 바뀌었고, `file demo`가 산출물이 진짜 ARM aarch64 바이너리임을 확인해 준다. 그리고 그 바이너리를 이 x86-64 개발 머신에서 그대로 실행하면 `Exec format error`로 죽는다 — 이 실패 자체가 크로스 컴파일이 하는 일을 가장 정확하게 보여준다. **컴파일에 성공한 바이너리를 그 자리에서 실행할 수 없다는 것**이 크로스 컴파일의 본질이고, 이 바이너리는 실제 ARM 보드(Raspberry Pi, Jetson 등)에 복사해야만 돌아간다.

::: interview
"크로스 컴파일이 뭐고 왜 필요한가"는 임베디드/로보틱스 포지션 면접에서 실제로 자주 나온다. 핵심 답변 뼈대: (1) 개발 머신과 타겟 하드웨어의 CPU 아키텍처가 다를 때 개발 머신에서 타겟용 바이너리를 만드는 것, (2) 타겟 보드가 느리거나 빌드 도구 자체가 못 올라가는 경우(RTOS, 아주 작은 임베디드)에 필수, (3) CMake에서는 툴체인 파일(`CMAKE_TOOLCHAIN_FILE`)로 컴파일러·시스템·탐색 경로를 재정의해서 처리한다는 것.
:::

## 로보틱스 연결: colcon은 패키지마다 이 전 과정을 대신 돌린다

ROS 2 워크스페이스에서 `colcon build`를 치면 화면에 CMake 명령이 안 보이지만, colcon은 워크스페이스 안의 `ament_cmake` 패키지마다 정확히 이 절에서 손으로 친 것과 같은 절차 — `cmake` 구성 → `cmake --build` → (필요하면) `cmake --install` — 를 패키지 단위로 반복한다. `colcon build --cmake-args -DCMAKE_BUILD_TYPE=Release`처럼 넘긴 인자는 그대로 각 패키지의 `cmake` 호출에 전달되고, 로봇 보드용으로 워크스페이스 전체를 크로스 컴파일해야 한다면 `--cmake-args -DCMAKE_TOOLCHAIN_FILE=toolchain-aarch64.cmake`를 워크스페이스 단위로 한 번 넘기는 식이다. `find_package(ament_cmake REQUIRED)`로 시작하는 모든 ROS 2 패키지의 `CMakeLists.txt` 첫 줄부터가 이 절의 `find_package()`이고, `ament_package()`가 내부적으로 하는 일도 위에서 손으로 짠 `install(EXPORT ...)`와 `configure_package_config_file()`의 확장판이다. [10.10 ament, colcon, 패키지 구조](#/ament-colcon)에서 이 대응 관계를 패키지 하나를 직접 만들며 전부 확인한다.

## 요약

- `find_package()`는 Module 모드(CMake 내장 `FindXxx.cmake`)와 Config 모드(라이브러리가 직접 설치하는 `XxxConfig.cmake`) 두 경로로 라이브러리를 찾는다 — Eigen3는 Config 모드라 "Found" 메시지가 안 찍혀도 정상이다.
- `Eigen3::Eigen`, `Threads::Threads` 같은 IMPORTED 타겟은 include 경로·컴파일 옵션·링크 대상을 전부 캡슐화한다 — `target_link_libraries()` 한 줄로 그 전부가 전이적으로 전파된다.
- `FetchContent`는 Git 저장소 같은 외부 소스를 구성 시점에 실제로 내려받아 `_deps/<name>-src`에 풀고 `add_subdirectory()`로 편입한다 — 이 환경에서 `doctest`를 실제로 내려받아 빌드·실행까지 확인했다. 이 경로는 빌드 시 네트워크를 요구하므로 ROS 2 오프라인 빌드 환경과는 상충할 수 있다.
- `install(EXPORT ...)` + `configure_package_config_file()`로 내 라이브러리를 `find_package()`로 찾을 수 있게 export할 수 있다 — 소비자 쪽 코드는 Eigen을 쓸 때와 문법이 완전히 같다.
- `CMAKE_BUILD_TYPE`은 실제 컴파일러 플래그를 바꾼다: 이 환경에서 Release는 `-O3 -DNDEBUG`(통설과 달리 `-O2`가 아니다), RelWithDebInfo는 `-O2 -g -DNDEBUG`, Debug는 `-g`뿐이었다(ASan은 이 예제가 직접 추가). 빈 값이면 아무 플래그도 안 붙는다 — 지정을 깜빡하는 게 흔한 실수다.
- 제너레이터 표현식(`$<CONFIG:Debug>`)은 빌드 파일을 찍어내는 시점에 설정별로 평가된다 — Visual Studio/Ninja Multi-Config 같은 다중 설정 제너레이터에서는 `if(CMAKE_BUILD_TYPE STREQUAL ...)`가 통하지 않으므로 이 방식이 유일한 이식 가능한 선택이다.
- 크로스 컴파일은 툴체인 파일(`CMAKE_SYSTEM_NAME`, `CMAKE_C/CXX_COMPILER`, `CMAKE_FIND_ROOT_PATH*`)로 개발 머신에서 다른 아키텍처(ARM 로봇 보드 등)용 바이너리를 만드는 절차다.

::: quiz 연습문제
1. `find_package(Eigen3 REQUIRED)`가 아무 "Found" 메시지도 안 찍었는데 구성이 성공했다. 이게 왜 정상인지 Module 모드와 Config 모드의 차이로 설명하라.
2. `FetchContent`로 받아온 의존성과 `find_package()`로 찾은 의존성 중 어느 쪽이 ROS 2 워크스페이스의 오프라인/재현 가능 빌드에 더 적합한지, 그리고 그 이유를 써라.
3. (예측) `CMAKE_BUILD_TYPE`을 아무것도 지정하지 않고 배포용 바이너리를 만들었다고 하자. 이 바이너리에서 `assert()` 호출이 실제로 동작하는지, 최적화가 얼마나 적용됐는지 이 절의 실측 결과를 근거로 예측하라.
4. (실습, 코드 작성형) 이 절의 `find_pkg_demo` 프로젝트를 직접 타이핑해서 `find_package(Eigen3 REQUIRED)`, `find_package(Threads REQUIRED)`로 구성하고, `cmake --build . -- VERBOSE=1`로 실제 컴파일 명령에 `-isystem` 경로가 자동으로 붙는지 확인하라. 그다음 `target_compile_options(demo PRIVATE $<$<CONFIG:Release>:-DHEX_RELEASE_BUILD>)`를 추가하고 Debug/Release 각각으로 구성해서 `HEX_RELEASE_BUILD` 매크로가 Release 빌드에서만 실제로 정의되는지 `-E` 전처리 출력이나 간단한 `#ifdef` 분기로 확인하라.
5. hexleg 라이브러리 예제에서 `hexleg::hexleg`처럼 네임스페이스 접두사를 붙인 IMPORTED 타겟을 쓰는 관례가 실제로 막아주는 문제 상황을 하나 들어라.
:::

::: answer 해설
1. Module 모드는 CMake 자신의 `FindXxx.cmake`를 쓰고 대개 `find_package_handle_standard_args()`로 "Found X: TRUE" 메시지를 표준화해서 찍는다. Eigen3는 이 Module이 없고 자체 `Eigen3Config.cmake`(Config 모드)를 제공하는데, 그 파일 안에 메시지 출력 코드가 없어서 아무것도 안 찍힌 것뿐이다 — 파일이 발견되고 `include()`가 에러 없이 끝났으면 성공이고, 실제로 `cmake ..`는 에러 없이 "Configuring done"으로 끝났다.
2. `find_package()`로 찾는 시스템 설치 의존성 쪽이 오프라인/재현 가능 빌드에 더 적합하다. `FetchContent`는 (첫 구성 시) 네트워크가 있어야 하고, 원격 저장소가 그 순간 응답 가능해야 하며, `GIT_TAG`가 실제로 그 시점에 존재해야 한다 — CI나 로봇 온보드처럼 네트워크가 제한되거나 재현성이 중요한 환경에서는 이 불확실성이 문제가 된다. `rosdep`/`apt`로 미리 시스템에 설치해 두고 `find_package()`로 찾는 쪽이 그 시점의 네트워크 상태와 무관하게 항상 같은 결과를 낸다.
3. `assert()`는 `-DNDEBUG`가 없으면 그대로 살아서 동작한다 — 이 절의 실측에서 `CMAKE_BUILD_TYPE`을 비워 둔 구성은 `-DNDEBUG`도, 어떤 최적화 플래그도 붙지 않았다(컴파일러 기본 동작뿐). 즉 이 상태로 배포하면 최적화가 전혀 안 된 느린 바이너리이면서 동시에 `assert()`가 실패하면 그 자리에서 프로그램이 그대로 죽는, 개발용도 배포용도 아닌 어정쩡한 바이너리가 나간다 — `CMAKE_BUILD_TYPE`을 명시적으로 지정해야 하는 이유다.
4. 실제로 실행하면 `-isystem /usr/include/eigen3`(또는 이 시스템의 Eigen 설치 경로)가 컴파일 명령에 그대로 나타나야 한다. `$<$<CONFIG:Release>:-DHEX_RELEASE_BUILD>`를 추가한 뒤 Release로 구성한 빌드의 전처리 결과나 `#ifdef HEX_RELEASE_BUILD` 분기의 실행 결과에서만 그 매크로가 켜져 있어야 하고, Debug 구성에서는 꺼져 있어야 한다.
5. 예를 들어 소비자 프로젝트가 우연히 자기 코드에 `hexleg`라는 이름의 지역 변수나 다른 타겟을 이미 쓰고 있었다면, 네임스페이스 없이 `hexleg`만 링크 대상으로 적었을 때 어느 쪽을 가리키는지 코드만 봐서는 헷갈릴 수 있다. `hexleg::hexleg`처럼 `::`가 붙은 이름은 CMake에서 반드시 "import된 타겟"이라는 뜻으로 예약돼 있어서, 이름이 겹쳐도 그 타겟을 안 쓰면 CMake가 그 자리에서 에러를 낸다 — 오타나 이름 충돌이 조용히 엉뚱한 것을 링크하는 사고로 이어지지 않는다.
:::

이 절의 네 프로젝트(`find_package` 데모, `FetchContent` 데모, `hexleg` 라이브러리와 그 소비자)는 전부 네 IDE 터미널에서 그대로 타이핑해서 확인하라. 기준 명령: `cmake .. && cmake --build . -- VERBOSE=1 && ./demo`. `FetchContent` 예제는 첫 `cmake ..` 실행에 네트워크가 필요하다는 것도 직접 확인해 봐라 — 두 번째 실행부터는 캐시 때문에 오프라인에서도 통과한다.

**다음 절**: [7.3 vcpkg와 Conan](#/package-managers) — `find_package`/`FetchContent`로 직접 엮은 의존성 관리를, 패키지 매니저가 어떻게 자동화하는지, 그리고 그게 ROS 2 생태계의 `rosdep`과 어떻게 다른지 본다.
