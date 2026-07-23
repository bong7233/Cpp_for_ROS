# 7.3 vcpkg와 Conan

::: lead
[7.2](#/cmake-advanced)의 `find_package`는 라이브러리가 시스템 어딘가에 **이미 설치돼 있다는 전제** 위에서 동작했다. 그 전제 자체가 C++에서는 당연하지 않다. 파이썬은 `pip install fmt` 한 줄이면 끝나고, Rust는 `Cargo.toml`에 한 줄 적으면 `cargo build`가 알아서 받아 온다. C++에는 그 한 줄이 없다. 이 절은 그 공백을 메우는 두 도구 vcpkg와 Conan을 실제로 이 환경에 설치하고 실제로 라이브러리를 받아 보면서, 되는 것과 안 되는 것을 있는 그대로 기록한다.
:::

## 라이브러리 하나 쓰는 데 드는 세 가지 선택지

`fmt`(빠른 문자열 포매팅 라이브러리) 하나를 프로젝트에 넣는다고 하자. C++ 표준은 이 라이브러리를 어디서 어떻게 받아야 하는지 아무 말도 하지 않는다. 남는 선택지는 세 가지뿐이다.

첫째, 소스를 직접 받아 프로젝트 안에 넣고 CMake로 함께 빌드한다. 헤더 전용 라이브러리면 그럭저럭 버틸 만하지만, 의존성이 여러 개로 늘어나면 각각의 빌드 옵션·버전·전이 의존성(A가 B를 요구하고 B가 C를 요구하는 사슬)을 전부 손으로 맞춰야 한다.

둘째, 시스템 패키지 매니저에 기댄다. 이 환경(Ubuntu 24.04 LTS, 코드명 noble)에서 실제로 확인한 결과다.

```console
$ apt-cache policy libfmt-dev
libfmt-dev:
  Installed: (none)
  Candidate: 9.1.0+ds1-2
  Version table:
     9.1.0+ds1-2 500
        500 http://archive.ubuntu.com/ubuntu noble/universe amd64 Packages
```

apt가 주는 `fmt`는 9.1.0이다. 같은 시각 vcpkg 저장소가 관리하는 `fmt` 포트 버전은 다음과 같다(뒤에서 실제로 클론해 확인한 값).

```console
$ cat vcpkg/ports/fmt/vcpkg.json | grep version
  "version": "12.2.0",
  "port-version": 1,
```

9.1.0과 12.2.0 — 메이저 버전이 세 단계나 차이 난다. apt가 이 정도로 뒤처지는 이유는 배포판의 안정성 정책 때문이다. LTS 배포판은 한번 굳힌 패키지 버전을 릴리스 수명 내내 거의 바꾸지 않는다. 그래서 apt는 "이 배포판에서 검증된 버전"을 주지, "지금 가장 최신인 버전"을 주지 않는다. 최신 기능이 필요하거나, 다른 OS(Windows, macOS)에서도 똑같은 버전을 쓰고 싶다면 apt만으로는 답이 안 나온다.

셋째가 이 절의 주제다 — **C++ 전용 패키지 매니저**를 쓴다. vcpkg(마이크로소프트가 시작해 지금은 커뮤니티가 포트를 채워 넣는 오픈소스 프로젝트)와 Conan(JFrog가 관리하는 오픈소스 프로젝트)이 사실상의 표준 두 축이다. 파이썬의 pip, Rust의 cargo와 다른 점은 이 둘이 **공식 표준이 아니라는 것** — C++ 표준위원회는 패키지 매니저를 규정한 적이 없고, 두 도구는 각자 독립적으로 생태계를 넓혀 온 경쟁 관계다.

::: hist 왜 C++만 공식 패키지 매니저가 없나
파이썬(1991)과 Rust(2010)는 언어와 배포 생태계를 처음부터 같이 설계했다. C++(1985)은 그보다 훨씬 오래됐고, 표준위원회의 권한은 언어 문법과 표준 라이브러리에 한정된다 — 빌드 시스템도, 패키지 배포도 표준의 영역 밖이다. 게다가 C++은 플랫폼(Windows/Linux/macOS/임베디드)과 컴파일러(MSVC/GCC/Clang)의 조합이 파이썬 휠(wheel)이 감당하는 조합보다 훨씬 넓다 — ABI가 컴파일러·표준 라이브러리 구현마다 갈라지는 언어에서 "미리 컴파일된 바이너리 하나로 다 해결"이 구조적으로 더 어렵다. vcpkg와 Conan 둘 다 "소스에서 그 자리에서 빌드"를 기본 전략으로 삼는 이유가 여기 있다.
:::

## vcpkg 실제로 써 보기: 클론은 되고, 부트스트랩은 막혔다

이 환경에 네트워크가 실제로 되는지부터 확인했다.

```console
$ git clone --depth 1 https://github.com/microsoft/vcpkg.git
Cloning into 'vcpkg'...
Updating files: 100% (14137/14137), done.
$ git -C vcpkg log -1 --format="%H %ci"
4493042c759d3bdff26164695dbee500d1e696c8 2026-07-22 02:36:55 -0700
```

클론은 문제없이 끝났다 — GitHub 저장소 자체에는 접근할 수 있다는 뜻이다. vcpkg는 저장소 안에 실행 파일을 넣어 두지 않는다. 대신 `bootstrap-vcpkg.sh`가 첫 실행 시 GitHub 릴리스에서 미리 컴파일된 `vcpkg` 바이너리(또는 실패하면 소스에서 직접 빌드)를 받아 온다. 실제로 돌려 봤다.

```console
$ ./vcpkg/bootstrap-vcpkg.sh -disableMetrics
Downloading vcpkg-glibc...
curl: (22) The requested URL returned error: 403
```

403의 정체를 `bash -x`로 추적하면 정확히 이 URL이다.

```console
$ curl -sSL "https://github.com/microsoft/vcpkg-tool/releases/download/2026-07-13/vcpkg-glibc"
{"message":"GitHub access to this repository is not enabled for this session.
 documentation_url":"https://docs.anthropic.com/en/docs/claude-code/github-actions"}
```

이 절을 실제로 실행한 환경은 저장소 코드를 `git clone`하는 것과, 릴리스에 첨부된 바이너리 자산(asset)을 내려받는 것을 서로 다른 경로로 취급하고 있었다 — 전자는 허용, 후자는 세션 정책상 차단이었다. `bootstrap-vcpkg.sh`가 소스 빌드로 넘어가는 대체 경로(플랫폼을 못 알아볼 때)도 같은 `microsoft/vcpkg-tool` 저장소의 아카이브를 받아 오므로 똑같이 막힌다. 이 환경에서는 vcpkg의 실제 설치·라이브러리 빌드까지는 검증하지 못했다 — **네트워크 접근 자체가 되고 안 되고의 문제가 아니라, 어떤 종류의 GitHub 요청이 이 세션에 허용돼 있는지의 문제였다는 것까지가 실측한 사실이다.** 사내망이나 CI 러너에서 GitHub 저장소 클론은 되는데 릴리스 자산 다운로드만 별도 방화벽 규칙에 걸리는 경우가 실제로 있다 — vcpkg를 처음 도입할 때 흔히 겪는 종류의 네트워크 문제이므로, 이 실패 자체도 기록해 둘 값어치가 있다.

::: warn 사내망에서 vcpkg를 처음 쓸 때
`bootstrap-vcpkg.sh`/`bootstrap-vcpkg.bat`는 `github.com`(코드)뿐 아니라 릴리스 자산이 실제로 저장된 호스트까지 뚫려 있어야 한다. 방화벽이 `github.com`만 허용하고 자산 다운로드를 막는 구성이면 이 절에서 본 것과 똑같은 403/404를 만난다. 사내 미러나 프록시 예외 목록에 vcpkg 릴리스 다운로드 경로를 추가해야 한다.
:::

바이너리는 못 받았지만, 클론된 저장소 자체는 실제 파일이다. 이후 절들은 이 실물 파일을 그대로 읽어서 구조를 설명한다 — 추측이 아니라 실제로 클론된 커밋(위 해시)의 내용이다.

## vcpkg의 구조: 포트, 매니페스트, 툴체인 파일

vcpkg가 관리하는 라이브러리 하나하나를 **포트(port)**라고 부른다. 저장소를 직접 세어 보면 이렇다.

```console
$ ls vcpkg/ports | wc -l
2854
```

포트 하나는 디렉터리 하나다. `fmt` 포트를 열어 보면 이렇다.

```console
$ ls vcpkg/ports/fmt
portfile.cmake  usage  vcpkg.json
```

`vcpkg.json`은 그 라이브러리의 메타데이터 — 이름, 버전, 이 포트를 빌드하는 데 필요한 다른 포트(빌드 의존성)를 선언한다.

```json title="vcpkg/ports/fmt/vcpkg.json (실제 클론 내용)"
{
  "name": "fmt",
  "version": "12.2.0",
  "port-version": 1,
  "description": "{fmt} is an open-source formatting library ...",
  "homepage": "https://github.com/fmtlib/fmt",
  "license": "MIT",
  "dependencies": [
    { "name": "vcpkg-cmake", "host": true },
    { "name": "vcpkg-cmake-config", "host": true }
  ]
}
```

`portfile.cmake`는 실제로 그 라이브러리를 어디서 받아서 어떻게 빌드하는지 적은 CMake 스크립트다. `fmt` 포트의 핵심부다.

```cmake title="vcpkg/ports/fmt/portfile.cmake (앞부분, 실제 클론 내용)"
vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO fmtlib/fmt
    REF "${VERSION}"
    SHA512 5ac2ba0f54a484999ed5407d82b77aad170cea49a267decd2c0eedadf3b14413e2a83fcc8e9ca9c16640595e019b8636e160f72314d8be50653324e82ac745eb
    HEAD_REF master
)
vcpkg_cmake_configure(
    SOURCE_PATH "${SOURCE_PATH}"
    OPTIONS -DFMT_CMAKE_DIR=share/fmt
)
```

`vcpkg_from_github`이 GitHub의 `fmtlib/fmt` 저장소에서 정확히 `REF`에 적힌 버전을 받고, `SHA512`로 무결성을 검증한다. 이게 이 절 앞부분에서 겪은 것과 같은 종류의 다운로드다 — vcpkg의 라이브러리 설치도 결국 GitHub(또는 각 라이브러리의 배포처)에서 소스를 받아 오는 일이므로, 그 경로가 막힌 네트워크에서는 `vcpkg install`도 같은 이유로 실패한다.

`usage` 파일은 설치가 끝난 뒤 사용자에게 보여줄 안내문이다.

```text nolines title="vcpkg/ports/fmt/usage (실제 내용)"
The package fmt provides CMake targets:
    find_package(fmt CONFIG REQUIRED)
    target_link_libraries(main PRIVATE fmt::fmt)
```

포트가 실제로 빌드되는 대상(플랫폼·아키텍처·링크 방식의 조합)은 **triplet**이 정한다. 저장소에 실제로 들어 있는 triplet 파일 일부다.

```console
$ ls vcpkg/triplets
arm64-linux.cmake  arm64-osx.cmake  x64-android.cmake  x64-linux.cmake  ...
```

`x64-linux`는 리눅스 x86-64용 동적 링크 기본 설정, `x64-windows-static-md` 같은 이름은 윈도우에서 정적 라이브러리 + 동적 런타임(MD) 조합을 뜻한다 — 같은 라이브러리라도 어떤 triplet으로 빌드했는지에 따라 나오는 결과물이 다르다.

## 매니페스트 모드: vcpkg.json으로 프로젝트별 의존성 선언

여기부터는 vcpkg 사용자 입장의 파일이다 — 방금 본 `ports/fmt/vcpkg.json`은 vcpkg *저장소 안*의 파일이었고, 지금 만드는 것은 **당신의 프로젝트 루트**에 놓는 별개의 `vcpkg.json`이다. 이름이 같아서 헷갈리기 쉽다.

```json title="프로젝트 루트/vcpkg.json"
{
  "name": "hexpider-leg-controller",
  "version": "0.1.0",
  "dependencies": [
    "fmt",
    "nlohmann-json"
  ]
}
```

이 파일 하나가 파이썬의 `requirements.txt`/`pyproject.toml`이나 Rust의 `Cargo.toml`과 같은 역할을 한다 — **이 프로젝트가 무엇을 필요로 하는지를 코드와 같이 저장소에 커밋한다.** 예전 방식(클래식 모드)은 `vcpkg install fmt`를 vcpkg 설치 폴더 전역에 실행해 컴퓨터 전체가 공유하는 라이브러리 더미를 만들었다 — 프로젝트 A가 `fmt` 8.0을, 프로젝트 B가 `fmt` 10.0을 원하면 그 순간 충돌한다. 매니페스트 모드는 각 프로젝트가 `vcpkg.json`으로 선언한 의존성을 **그 프로젝트만의 격리된 `vcpkg_installed/` 폴더**에 받는다 — 프로젝트마다 다른 버전을 동시에 가질 수 있다는 뜻이다. 지금 vcpkg 공식 문서가 권장하는 기본값이 이 매니페스트 모드다.

::: note requirements.txt/Cargo.toml과의 정확한 대응
`vcpkg.json`의 `"dependencies"` 배열은 이름만 나열한다는 점에서 `requirements.txt`의 느슨한 버전 없는 목록과 닮았다. 정확한 버전 고정이 필요하면 `"overrides"` 필드나 `builtin-baseline`(vcpkg 저장소의 특정 커밋을 기준점으로 고정)을 함께 쓴다 — 이게 `Cargo.lock`/`package-lock.json`이 하는 "정확히 이 버전으로 고정" 역할에 대응한다.
:::

## CMakeLists.txt와의 통합: CMAKE_TOOLCHAIN_FILE

vcpkg가 라이브러리를 실제로 받아 놓아도, CMake가 그 위치를 모르면 `find_package`는 여전히 실패한다. vcpkg는 이 연결을 **툴체인 파일**로 해결한다. 클론된 저장소에 실제로 존재하는 파일이다.

```console
$ wc -l vcpkg/scripts/buildsystems/vcpkg.cmake
987 vcpkg/scripts/buildsystems/vcpkg.cmake
```

CMake를 처음 구성(configure)할 때 이 파일을 `CMAKE_TOOLCHAIN_FILE`로 지정하면, `find_package`가 vcpkg가 설치한 위치까지 뒤진 뒤에야 실패를 선언한다.

```console
$ cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=./vcpkg/scripts/buildsystems/vcpkg.cmake
```

`CMakeLists.txt` 쪽은 [7.1](#/cmake-basics)에서 배운 `find_package` + `target_link_libraries` 그대로다 — vcpkg를 쓴다고 CMake 문법이 바뀌지 않는다는 게 핵심이다.

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.20)
project(hexpider_leg_controller CXX)

find_package(fmt CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

add_executable(leg_controller src/main.cpp)
target_link_libraries(leg_controller PRIVATE fmt::fmt nlohmann_json::nlohmann_json)
```

툴체인 파일이 하는 일은 딱 하나다 — `CMAKE_PREFIX_PATH`에 vcpkg가 설치한 라이브러리 폴더(`vcpkg_installed/<triplet>`)를 끼워 넣어서, `find_package`가 시스템 경로를 뒤지기 전에 그곳부터 찾아보게 만드는 것. `find_package`를 호출하는 쪽 코드는 vcpkg를 쓰든 시스템 apt 패키지를 쓰든 한 글자도 다르지 않다 — 이게 vcpkg가 "기존 CMake 프로젝트에 최소 침습으로 끼워 넣을 수 있다"고 홍보하는 이유의 실체다.

::: danger apt와 vcpkg를 섞어 쓸 때
같은 라이브러리를 시스템 apt(`libfmt-dev`, 9.1.0)와 vcpkg(`fmt`, 12.2.0)로 동시에 설치해 두면 `find_package(fmt)`가 어느 쪽을 찾을지는 `CMAKE_PREFIX_PATH`의 순서에 달렸다 — 툴체인 파일을 쓰면 보통 vcpkg 쪽이 먼저 잡히지만, 헤더 경로가 꼬여 컴파일은 vcpkg의 12.x 헤더로, 링크는 apt의 9.x 라이브러리로 섞이는 사고가 실제로 난다. ABI가 다른 두 버전이 한 실행 파일에 섞이면 링크는 성공해도 실행 중 크래시로 나타날 수 있다 — 이런 문제는 vcpkg가 설치한 것과 시스템이 설치한 것 중 **하나만** 골라 쓰고, 나머지는 아예 지우는 것으로 피한다.
:::

## Conan: 바이너리 패키지 중심, 프로파일 기반

Conan은 vcpkg와 목표는 같지만 접근이 다르다. vcpkg는 대체로 "그 자리에서 소스를 빌드"가 기본이고, Conan은 **미리 빌드된 바이너리 패키지**를 서버(ConanCenter)에서 내려받는 걸 우선한다 — 소스 빌드는 맞는 바이너리가 없을 때의 대비책이다. 이 환경에는 이미 pip으로 설치돼 있었다.

```console
$ conan --version
Conan version 2.27.0
```

Conan은 "이 컴퓨터/컴파일러 조합에서 어떻게 빌드할지"를 **프로파일**이라는 별도 파일로 관리한다 — vcpkg의 triplet과 같은 역할이다. 실제로 자동 감지시켜 봤다.

```console
$ conan profile detect --force
detect_api: Found cc=gcc-13.3.0
Detected profile:
[settings]
arch=x86_64
build_type=Release
compiler=gcc
compiler.cppstd=gnu17
compiler.libcxx=libstdc++11
compiler.version=13
os=Linux
Saving detected profile to /root/.conan2/profiles/default
```

프로젝트가 무엇을 필요로 하는지는 `conanfile.txt`(또는 파이썬으로 로직을 넣을 수 있는 `conanfile.py`)에 적는다.

```text title="conanfile.txt"
[requires]
fmt/11.0.2

[generators]
CMakeDeps
CMakeToolchain
```

`conan install`을 실제로 돌려 봤다.

```console
$ conan install . --output-folder=build --build=missing
fmt/11.0.2: Not found in local cache, looking in remotes...
fmt/11.0.2: Checking remote: conancenter
ERROR: Package 'fmt/11.0.2' not resolved:
HTTPSConnectionPool(host='center2.conan.io', port=443): Max retries exceeded
 (Caused by ProxyError('Unable to connect to proxy',
 OSError('Tunnel connection failed: 403 Forbidden')))
```

vcpkg가 GitHub 릴리스 자산에서 막혔던 것과 같은 종류의 벽을, Conan은 자신의 패키지 서버(`center2.conan.io`, ConanCenter의 백엔드)에서 만났다 — 이 환경의 네트워크 정책이 pip(PyPI)은 허용하면서 ConanCenter는 허용하지 않는 구성이었다는 뜻이다. `CMakeDeps`/`CMakeToolchain` 생성기가 실제로 만들어 내는 `fmtConfig.cmake`, `conan_toolchain.cmake` 같은 파일까지는 이 환경에서 실물로 받아 확인하지 못했다 — vcpkg 절과 마찬가지로 여기서도 정직하게 실패로 남긴다. `conan profile detect`처럼 네트워크 없이 로컬에서 끝나는 명령은 실제로 동작을 확인했고, 원격 저장소에서 패키지를 받는 명령은 이 환경에서 막혔다는 것이 실측된 경계선이다.

::: tip vcpkg와 Conan, 실무에서 어떻게 고르나
표준 정답은 없다. ROS 2 생태계와 자주 얽히는 리눅스 위주 프로젝트라면 vcpkg 쪽 커뮤니티 포트(2,854개, 이 절에서 실제로 센 숫자)가 더 넓게 느껴질 때가 많고, 크로스 플랫폼 CI에서 바이너리 캐시로 빌드 시간을 확 줄이고 싶다면 Conan의 바이너리 우선 전략이 유리하다. 둘 다 매니페스트 파일(`vcpkg.json`/`conanfile.txt`)을 저장소에 커밋해 재현성을 얻는다는 점은 같다.
:::

## 언제 무엇을 쓰는가 — vcpkg/Conan, apt, FetchContent의 경계

세 가지 선택지를 판단 기준으로 다시 정리한다.

- **크로스 플랫폼 재현성이 핵심이면 vcpkg/Conan.** 같은 `vcpkg.json`/`conanfile.txt`를 커밋해 두면 리눅스든 윈도우든 macOS든 팀원 전체가 똑같은 버전의 의존성을 받는다. 배포판마다 apt 버전이 갈리는 이 절 앞부분의 문제(9.1.0 vs 12.2.0)가 애초에 발생하지 않는다.
- **헤더 전용의 작은 라이브러리 하나면 [7.2](#/cmake-advanced)의 `FetchContent`.** 별도 패키지 매니저를 설치할 필요 없이 `CMakeLists.txt` 안에서 `FetchContent_Declare`로 GitHub 저장소를 직접 받아 빌드에 끼워 넣을 수 있다. 의존성이 하나둘일 때는 이 쪽이 도구 체인을 늘리지 않는다는 점에서 더 가볍다.
- **배포 환경이 고정돼 있으면 시스템 패키지(apt)도 충분하다.** 로봇 한 대에 Ubuntu 24.04를 딱 박아 놓고 그 위에서만 돌릴 게 확실하다면, apt가 주는 버전이 최신이 아니어도 안정성과 보안 업데이트를 배포판이 대신 챙겨 준다는 이점이 있다. Docker 이미지 하나로 빌드 환경을 고정하는 경우([0.2](#/toolchain-setup)의 ROS 2 Humble Docker 환경이 정확히 이 사례다)가 여기 해당한다.

::: interview "C++은 왜 pip 같은 공식 패키지 매니저가 없나"라고 물으면
표면적인 답("표준위원회가 안 정해서")에서 멈추지 말고, ABI 문제까지 짚는 게 차이를 만든다 — 컴파일러·표준 라이브러리 구현마다 이름 맹글링과 객체 레이아웃이 달라서([1.1](#/compile-model), [2.12](#/object-layout)), 파이썬 휠 같은 "미리 컴파일된 바이너리 하나로 전 플랫폼 해결"이 구조적으로 더 어렵다는 것까지 답하면 한 단계 더 들어간 답이 된다. vcpkg와 Conan이 왜 "그 자리에서 소스 빌드"를 기본 전략으로 삼는지도 같은 이유에서 나온다는 걸 덧붙이면 좋다.
:::

## 로보틱스 도메인: colcon과 rosdep은 다른 계층의 도구다

ROS 2는 이 절의 도구들과 별개로 자기 자신의 빌드·의존성 도구를 이미 갖고 있다 — `colcon`(여러 ROS 2 패키지를 한 번에 빌드하는 오케스트레이터, [10.10](#/ament-colcon)에서 다룬다)과 `rosdep`(각 ROS 2 패키지의 `package.xml`에 적힌 의존성 이름을 그 배포판의 시스템 패키지 이름으로 바꿔 apt로 설치해 주는 도구)이다. 역할이 겹치지 않는다 — `rosdep`은 정확히 이 절의 두 번째 선택지(시스템 패키지)를 자동화한 것이고, vcpkg/Conan은 ROS 2 패키지가 아닌 **일반 C++ 라이브러리**(Eigen, fmt, nlohmann-json 같은)를 ROS 2 빌드 시스템 바깥에서 끌어올 때 쓴다. 헥사포드 제어 소프트웨어 안에서 순수 C++ 유틸리티 라이브러리 하나가 필요할 때, 그게 `rosdep`이 아는 ROS 2 패키지 목록에 없다면 이 절의 vcpkg/Conan이나 [7.2](#/cmake-advanced)의 `FetchContent`가 그 자리를 채운다.

## 요약

- C++에는 공식 패키지 매니저가 없다 — 직접 소스를 빌드하거나, 시스템 패키지(apt)에 기대거나, C++ 전용 패키지 매니저(vcpkg/Conan)를 쓰는 세 갈래뿐이다.
- 이 환경에서 apt의 `fmt`는 9.1.0, vcpkg 포트의 `fmt`는 12.2.0이었다 — 배포판 안정성 정책 때문에 벌어지는 실측된 버전 격차다.
- vcpkg는 `git clone`으로 저장소를 받는 데는 성공했지만, `bootstrap-vcpkg.sh`가 GitHub 릴리스 자산을 받는 단계에서 403으로 막혔다 — 이 세션이 저장소 코드 접근과 릴리스 자산 다운로드를 다른 권한으로 취급하고 있었다는 뜻이다.
- vcpkg는 포트(라이브러리별 `vcpkg.json` + `portfile.cmake`) 2,854개를 관리하고, triplet으로 플랫폼별 빌드를 구분하며, 프로젝트 루트의 매니페스트 `vcpkg.json`으로 프로젝트별 의존성을 격리해 선언한다.
- CMake와의 통합은 `CMAKE_TOOLCHAIN_FILE`로 `vcpkg.cmake`를 지정하는 것 하나뿐이다 — `find_package`/`target_link_libraries` 문법은 바뀌지 않는다.
- Conan은 이미 설치돼 있었고(`conan --version` → 2.27.0) 로컬 명령(`conan profile detect`)은 정상 동작했지만, ConanCenter(`center2.conan.io`)에서 실제 패키지를 받는 `conan install`은 같은 종류의 네트워크 제약으로 실패했다.
- 판단 기준: 크로스 플랫폼 재현성이 핵심이면 vcpkg/Conan, 헤더 전용 라이브러리 하나면 `FetchContent`([7.2](#/cmake-advanced)), 배포 환경이 고정돼 있으면 시스템 패키지로 충분하다.
- `colcon`+`rosdep`은 ROS 2 패키지 생태계 안의 도구이고, vcpkg/Conan은 그 바깥의 일반 C++ 라이브러리를 다룬다 — 역할이 겹치지 않는다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 판단 문제, 4번은 네 컴퓨터에서 직접 실행해서 확인하는 실습이다.

1. 이 절이 실측한 apt의 `fmt` 9.1.0과 vcpkg 포트의 `fmt` 12.2.0 사이의 버전 격차가 왜 생기는지, "배포판의 안정성 정책"이라는 관점에서 설명하라.

2. vcpkg의 매니페스트 모드가 클래식 모드(전역 설치)보다 나은 점을 "프로젝트 A와 B가 서로 다른 버전의 같은 라이브러리를 원할 때"를 예로 들어 설명하라.

3. (판단) 헥사포드 제어 소프트웨어에 헤더 전용 소규모 유틸리티 라이브러리 하나만 추가하면 되는 상황과, Eigen·fmt·Google Test 등 대여섯 개의 라이브러리를 리눅스·CI 양쪽에서 동일한 버전으로 재현 가능하게 관리해야 하는 상황을 비교해서, 각각 이 절의 어느 도구(FetchContent/apt/vcpkg·Conan)를 쓸지와 그 이유를 써라.

4. (실습, 코드 작성형) 네 IDE 환경에서 vcpkg를 직접 클론하고 부트스트랩해 보라. `git clone https://github.com/microsoft/vcpkg.git && ./vcpkg/bootstrap-vcpkg.sh -disableMetrics`를 실행한 뒤, 이 절이 겪은 것과 같은 네트워크 오류가 나는지, 아니면 정상적으로 `vcpkg` 실행 파일이 만들어지는지 확인하라. 성공했다면 `./vcpkg/vcpkg install fmt`로 실제 라이브러리를 하나 설치하고, 위 CMakeLists.txt 예시에 `CMAKE_TOOLCHAIN_FILE`을 연결해 `fmt::format`을 호출하는 최소 프로그램을 컴파일까지 통과시켜라.
:::

::: answer 해설
1. LTS 배포판은 릴리스 시점에 각 패키지 버전을 고정하고, 배포판 수명 내내 그 버전에 보안 패치만 backport한다 — 기능 업데이트를 위해 메이저 버전을 올리지 않는다. 그래서 배포판이 오래될수록 apt가 주는 버전과 라이브러리 상류(upstream)의 최신 버전 사이 격차가 커진다. vcpkg 포트는 이런 정책 없이 라이브러리의 새 릴리스가 나올 때마다 비교적 빠르게 포트를 갱신하므로 최신에 더 가깝다.
2. 클래식 모드는 vcpkg 설치 폴더 하나를 컴퓨터의 모든 프로젝트가 공유한다 — 그 폴더 안의 `fmt`는 버전이 하나뿐이므로, 프로젝트 A가 `fmt` 8.0의 API에 맞춰 짜여 있고 프로젝트 B가 `fmt` 10.0의 새 기능을 쓰고 싶다면 한쪽은 반드시 깨진다. 매니페스트 모드는 프로젝트마다 별도의 `vcpkg_installed/` 폴더를 만들어 그 프로젝트의 `vcpkg.json`에 적힌 버전만 그 폴더 안에 설치하므로, A와 B가 컴퓨터 하나에서 서로 다른 `fmt` 버전을 동시에 갖고 있어도 충돌하지 않는다.
3. 헤더 전용 소규모 라이브러리 하나라면 `FetchContent`가 낫다 — 별도 패키지 매니저 설치·부트스트랩·매니페스트 관리라는 비용을 들이지 않고 `CMakeLists.txt` 안에서 바로 해결되기 때문이다. 반대로 대여섯 개의 라이브러리를 여러 플랫폼·CI에서 똑같은 버전으로 재현해야 하는 상황이면 vcpkg나 Conan이 낫다 — 매니페스트 파일 하나(`vcpkg.json`/`conanfile.txt`)를 커밋해 두면 각 환경이 알아서 같은 버전 조합을 재현하고, 라이브러리 개수가 늘어날수록 이 재현성의 가치가 `FetchContent`를 하나씩 손으로 선언하는 비용을 넘어선다.
4. 이 절이 겪은 403은 이 절을 쓴 특정 환경의 네트워크 정책 때문이었다 — 일반적인 개발 PC나 Hexpider의 ROS 2 Humble Docker 환경에서는 GitHub 릴리스 자산 다운로드가 보통 막혀 있지 않으므로, 대부분 정상적으로 `vcpkg` 실행 파일이 만들어지고 `vcpkg install fmt`도 성공해야 한다. 성공했다면 `find_package(fmt CONFIG REQUIRED)`와 `target_link_libraries(... fmt::fmt)`만으로 컴파일이 통과하는지가 성공 기준이다 — 실패했다면 이 절의 `::: warn` 상자가 말한 방화벽/프록시 설정을 의심해야 한다.
:::

이 절의 CMake 통합 코드는 직접 타이핑해서 네 컴퓨터에서 vcpkg 부트스트랩부터 끝까지 밟아 봐라. 기준 명령: `git clone https://github.com/microsoft/vcpkg.git && ./vcpkg/bootstrap-vcpkg.sh -disableMetrics && ./vcpkg/vcpkg install fmt && cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=./vcpkg/scripts/buildsystems/vcpkg.cmake && cmake --build build`.

**다음 절**: [7.4 gdb로 디버깅하기](#/gdb) — 의존성을 받아 링크까지 마쳤다면, 이제 그 프로그램이 실제로 무엇을 하고 있는지 중단점을 걸어 들여다볼 차례다.
