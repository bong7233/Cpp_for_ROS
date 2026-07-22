# 7.8 CI 파이프라인 구성

::: lead
[7.1](#/cmake-basics)부터 [7.7](#/static-analysis)까지 이 Part는 도구를 하나씩 늘려 왔다 — CMake로 빌드하고, gdb로 들여다보고, 새니타이저로 메모리·레이스를 잡고, GoogleTest로 회귀를 막고, clang-tidy로 코드 냄새를 걸렀다. 그런데 지금까지 이 모든 검증은 전부 "네 IDE 터미널에서 손으로 쳐 봐라"는 지시로 끝났다. 이 절은 그 손으로 치는 절차 자체를 커밋마다 자동으로 돌아가는 파이프라인으로 만든다. GitHub Actions 워크플로 파일을 실제로 짜고, 그 YAML이 문법적으로 유효한지 이 환경에서 실제로 검증한 결과까지 그대로 싣는다 — Part VII의 마지막 절답게, 앞선 일곱 절의 도구가 전부 이 파이프라인 하나에 모인다.
:::

## 손으로 돌리는 검증이 무너지는 지점

[7.6](#/googletest)이 이미 짚은 논리를 한 단계 더 밀어붙인다. 그 절은 "콘솔에 찍힌 숫자를 눈으로 대조하는 방식"이 함수 개수가 늘면 무너진다는 걸 보여주고, 그 대안으로 `TEST()`/`ctest`를 들였다. 그런데 `ctest`를 실행하는 행위 자체도 결국 사람이 터미널에 손으로 쳐야 일어난다 — 그리고 이 절은 정확히 그 지점이 왜 다시 무너지는지부터 본다.

첫째, **사람은 깜빡한다.** 헥사포드 제어 소프트웨어에 커밋 하나를 올리기 전에 `cmake --build build && ctest`를 매번 손으로 돌리는 습관은, 마감이 급하거나 "이건 한 줄만 고친 거라 안전하다"는 확신이 들 때 가장 먼저 생략된다. 그 "한 줄"이 실제로 [7.5](#/sanitizers)의 `heap-buffer-overflow`를 만드는 경우가 드물지 않다 — 사람이 스스로에게 거는 확신은 새니타이저가 잡는 버그의 성격과 아무 상관이 없다.

둘째, **팀원마다 다른 결과가 나온다.** 한 사람의 개발 머신에는 clang-tidy 18이 깔려 있고 다른 사람은 clang-tidy 14를 쓴다면, 같은 코드에 대해 [7.7](#/static-analysis)의 정적 분석이 서로 다른 경고를 낸다. 한 사람은 `-fsanitize=address,undefined`로 습관적으로 컴파일하고 다른 사람은 새니타이저를 아예 켜 본 적이 없다면, 같은 저장소에 대해 "내 눈에는 문제없다"는 결론이 사람마다 다르게 나온다. 검증 절차가 각자의 로컬 환경에 맡겨져 있으면, 그 절차 자체가 사람 수만큼 갈라진다.

셋째, 이 둘이 합쳐지면 로보틱스 프로젝트에서 특히 뼈아픈 실무 문구가 나온다 — **"내 컴퓨터에서는 되는데."** 리뷰어가 풀 리퀘스트를 승인할 때 "이 브랜치가 실제로 컴파일되고, 테스트를 통과하고, 새니타이저가 조용하다"는 걸 확인할 방법이 "작성자의 자기 보고" 말고는 없다면, 그 승인은 신뢰가 아니라 추측 위에 서 있는 것이다. [7.2](#/cmake-advanced)에서 이미 크로스 컴파일을 다루며 봤듯 개발 머신과 실제 배포 대상(ARM 로봇 보드)이 다를 수도 있다 — 검증이 사람 손에 맡겨져 있으면 "누구의 어떤 환경에서 검증했는가"라는 질문 자체가 매번 다시 열린다.

**지속적 통합(CI, Continuous Integration)**은 이 세 문제를 "검증 절차를 사람의 기억과 습관이 아니라, 커밋이 저장소에 올라가는 사건 자체에 묶는다"는 방향으로 푼다. 커밋이 푸시되거나 풀 리퀘스트가 열리는 순간, 사람이 아무것도 안 눌러도 정해진 서버(러너)가 정해진 절차를 그대로 실행하고, 그 결과를 성공/실패로 저장소 화면에 박아 넣는다. 사람이 잊어도 파이프라인은 잊지 않고, 팀원이 몇 명이든 실행되는 환경은 러너 하나로 고정된다.

## GitHub Actions 워크플로의 뼈대: 이벤트, job, step

GitHub Actions는 저장소의 `.github/workflows/` 아래 YAML 파일 하나가 워크플로 하나를 정의한다. 이 절은 이 저장소 자신이 아니라 **가상의 독립 프로젝트**(헥사포드 제어 소프트웨어, 저장소 이름은 `hexctl`이라고 가정한다)를 대상으로 예제를 짠다 — 이 파일은 학습 콘텐츠의 코드 블록일 뿐, 이 책이 담긴 저장소의 실제 `.github/workflows/`에는 아무것도 만들지 않는다.

워크플로 파일의 구조는 세 겹이다. **워크플로**는 파일 하나(`ci.yml`) 전체이고, `on:`에 적은 **이벤트**(`push`, `pull_request` 등)가 일어나면 실행된다. 워크플로 안에는 **job**이 여럿 있을 수 있고, 각 job은 기본적으로 서로 독립된 러너(가상 머신) 위에서 병렬로 돈다 — [7.5](#/sanitizers)에서 ASan과 TSan을 같은 빌드에 못 넣는다고 확인했던 것과 정확히 같은 이유로, 이 절의 새니타이저 검증도 job을 나눠야 한다는 게 뒤에서 나온다. job 안에는 순서대로 실행되는 **step**이 있고, 각 step은 셸 명령 하나(`run:`)이거나 미리 만들어진 재사용 가능한 동작(`uses:`, 액션)이다.

```yaml title=".github/workflows/ci.yml — 뼈대만"
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - run: echo "여기에 실제 빌드 단계가 들어간다"
```

::: note on: 이 YAML에서 예약어처럼 보이는 이유
`on:`은 YAML 1.1 스펙에서 `true`의 별칭으로 해석된다 — 실제로 이 절의 워크플로 파일을 파이썬 `yaml.safe_load()`로 파싱해 보면 최상위 키가 문자열 `"on"`이 아니라 불리언 `True`로 나온다(이 환경에서 PyYAML 6.0.1로 실제 확인). GitHub Actions 자체는 이 YAML 1.1 특성을 알고 있어서 워크플로 파일에서는 문제없이 `on:`을 이벤트 키로 처리하지만, YAML을 직접 파싱하는 도구를 만든다면 이 함정을 알아야 한다 — "노르웨이 문제(Norway problem)"라고 불리는 유명한 YAML 함정의 실제 사례다.
:::

## 빌드와 테스트: 체크아웃부터 ctest까지

첫 job은 [7.1](#/cmake-basics)의 `add_executable`/`target_link_libraries`로 짜인 `CMakeLists.txt`를 그대로 구성·빌드하고, [7.6](#/googletest)의 `gtest_discover_tests()`로 등록된 케이스를 `ctest`로 돌린다. 로컬 IDE 터미널에서 치던 명령과 순서가 완전히 같다는 게 핵심이다 — CI는 새로운 빌드 절차를 발명하지 않는다, 사람이 손으로 치던 절차를 그대로 자동화할 뿐이다.

```yaml title=".github/workflows/ci.yml — build-and-test job"
jobs:
  build-and-test:
    name: 빌드 + GoogleTest
    runs-on: ubuntu-24.04
    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: 의존성 캐시 (FetchContent가 받는 GoogleTest 등)
        uses: actions/cache@v4
        with:
          path: build/_deps
          key: ${{ runner.os }}-deps-${{ hashFiles('**/CMakeLists.txt') }}

      - name: CMake 구성
        run: cmake -B build -DCMAKE_BUILD_TYPE=Release

      - name: 빌드
        run: cmake --build build --parallel

      - name: ctest 실행
        working-directory: build
        run: ctest --output-on-failure
```

`actions/checkout@v4`가 첫 step인 이유는 단순하다 — 러너는 매번 완전히 새 가상 머신이라, 저장소 코드가 그 위에 아무것도 없는 상태에서 시작한다. `actions/cache@v4`는 다음 절에서 따로 다룬다. 나머지 세 step은 [7.1](#/cmake-basics)의 `cmake -B build`, `cmake --build build`, [7.6](#/googletest)의 `ctest --output-on-failure`와 글자 하나 다르지 않다 — `working-directory: build`로 작업 디렉터리를 바꿔 주는 것만 CI 파일 특유의 문법이다.

## 새니타이저 job을 반드시 나누는 이유

[7.5](#/sanitizers)에서 실제로 컴파일까지 해서 확인한 사실이 하나 있다 — `-fsanitize=address,thread`를 같이 넣으면 `cc1plus`가 그 자리에서 "incompatible" 에러를 낸다. ASan과 TSan은 둘 다 가상 주소 공간을 자기 방식으로 재배치하려 들어서 한 빌드 안에 공존할 수 없다. 이 제약이 CI 설계에 그대로 옮겨진다 — **한 job 안에서 두 새니타이저를 동시에 켜는 빌드를 만들 방법 자체가 없으므로, job을 반드시 둘로 나눠야 한다.**

GitHub Actions는 `strategy.matrix`로 "같은 job 정의를 여러 변형으로 반복 실행"하는 문법을 제공한다. 새니타이저 조합을 매트릭스 축 하나로 선언하면, `address,undefined` 빌드와 `thread` 빌드가 각각 독립된 러너에서 병렬로 돈다.

```yaml title=".github/workflows/ci.yml — sanitizers job"
  sanitizers:
    name: 새니타이저 (${{ matrix.sanitizer.name }})
    runs-on: ubuntu-24.04
    strategy:
      fail-fast: false
      matrix:
        sanitizer:
          - name: address+undefined
            flags: "address,undefined"
          - name: thread
            flags: "thread"
    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: 의존성 캐시
        uses: actions/cache@v4
        with:
          path: build/_deps
          key: ${{ runner.os }}-deps-${{ hashFiles('**/CMakeLists.txt') }}

      - name: 새니타이저 빌드로 구성
        run: |
          cmake -B build \
            -DCMAKE_BUILD_TYPE=Debug \
            -DCMAKE_CXX_FLAGS="-fsanitize=${{ matrix.sanitizer.flags }}" \
            -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=${{ matrix.sanitizer.flags }}"

      - name: 빌드
        run: cmake --build build --parallel

      - name: ctest 실행 (새니타이저 계측 상태로)
        working-directory: build
        run: ctest --output-on-failure
```

`matrix.sanitizer`가 두 값(`address+undefined`, `thread`)을 갖고 있으므로 이 job은 실제로는 러너 두 대에서 각각 한 번씩, 총 두 번 실행된다 — `sanitizers (address+undefined)`와 `sanitizers (thread)`가 저장소 화면에 별도의 체크로 나타난다. `fail-fast: false`를 명시한 이유가 중요하다 — 기본값(`true`)이면 매트릭스의 한 조합이 실패하는 즉시 나머지 조합의 실행이 취소된다. 그런데 이 두 job은 [7.5](#/sanitizers)에서 확인했듯 서로 다른 종류의 버그(메모리 범위 대 스레드 동기화)를 잡는 완전히 독립된 검증이다 — `thread` 빌드가 먼저 실패했다고 `address+undefined` 빌드 결과까지 못 보게 되면, 그 커밋에 메모리 버그도 있는지 알 기회를 잃는다.

::: danger CMAKE_BUILD_TYPE을 Debug로 고정해야 하는 이유
[7.2](#/cmake-advanced)에서 실측했듯 `Release`는 `-DNDEBUG`를 자동으로 붙여서 `assert()`를 통째로 지운다. 새니타이저 job에서 `Release`로 구성하면 진단 대상 중 하나(assert가 걸러야 할 논리 오류)가 애초에 컴파일에서 빠진 채로 검사가 돌아간다 — 새니타이저 job은 반드시 `Debug`(또는 최소한 `-DNDEBUG` 없는 구성)로 고정한다.
:::

## clang-tidy를 파이프라인에 끼워 넣는다

[7.7 clang-tidy와 정적 분석](#/static-analysis)은 실행조차 안 해 보고 코드 패턴 자체를 검사한다 — 새니타이저가 "실행된 경로의 버그"만 잡는다는 한계([7.5](#/sanitizers)의 `::: deep` 상자가 짚은 지점)를 메우는 자리다. CI에서는 이걸 별도 job(또는 최소한 별도 step)으로 둔다 — 빌드·테스트가 통과했어도 정적 분석 경고는 남아 있을 수 있고, 그 반대도 성립하기 때문에 서로 다른 결과를 저장소 화면에서 각자 확인할 수 있어야 한다.

```yaml title=".github/workflows/ci.yml — static-analysis job"
  static-analysis:
    name: clang-tidy 정적 분석
    runs-on: ubuntu-24.04
    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: clang-tidy 설치
        run: sudo apt-get update && sudo apt-get install -y clang-tidy

      - name: CMake 구성 (컴파일 DB 생성)
        run: cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

      - name: clang-tidy 실행
        run: |
          run-clang-tidy -p build \
            $(git ls-files 'src/*.cpp' 'include/*.hpp')
```

`CMAKE_EXPORT_COMPILE_COMMANDS=ON`이 [7.7](#/static-analysis)에서 다룬 `compile_commands.json`을 만든다 — clang-tidy가 각 파일을 정확히 어떤 플래그로 컴파일하는지 알아야 하기 때문에, 이 컴파일 데이터베이스 없이는 정적 분석 자체가 부정확해진다. `.clang-tidy` 설정 파일이 저장소 루트에 있다면 `run-clang-tidy`가 그걸 자동으로 읽는다 — CI에서 별도로 규칙을 다시 적을 필요가 없다는 뜻이다.

## 이 YAML이 실제로 유효한가 — actionlint·yamllint 실측

이 절의 워크플로 파일은 실제 GitHub 저장소에 올려서 실행해 본 게 아니다 — 그렇게 하려면 이 콘텐츠와 무관한 실제 저장소·실제 푸시가 필요하고, 이 절의 스코프를 벗어난다. 대신 **이 YAML이 문법적으로, 그리고 GitHub Actions 스키마상으로 유효한지**는 이 환경에서 실제로 두 도구를 설치해 검증했다 — 추측이 아니라 실제로 돌린 결과다.

먼저 이 절의 세 job(build-and-test, sanitizers, static-analysis)을 합친 전체 파일을 `yamllint`(1.38.0, `pip install yamllint`로 이 환경에 설치)로 돌렸다.

```console
$ yamllint ci.yml
ci.yml
  1:1       warning  missing document start "---"  (document-start)
  3:1       warning  truthy value should be one of [false, true]  (truthy)
```

두 경고 모두 에러가 아니라 경고이고(종료 코드 0), 첫째는 문서 시작 표시(`---`)가 없다는 스타일 지적, 둘째가 바로 위 `::: note`에서 다룬 `on:` 키가 YAML 1.1에서 불리언으로 해석되는 문제다 — `yamllint`가 문법 검사기로서 이 함정을 정확히 짚어 낸 것이다. GitHub Actions 워크플로 파일은 관례적으로 이 truthy 경고를 무시하는 게 표준적인 관행이다(`on:`을 문자열로 강제하면 GitHub Actions 자체가 워크플로를 인식 못 한다).

`yamllint`는 YAML 문법만 본다 — "이 파일이 GitHub Actions 워크플로로서 말이 되는가"는 별개의 질문이다. 이 검사에는 GitHub Actions 스키마를 직접 아는 전용 도구 `actionlint`(v1.7.12, 이 환경에 Go 툴체인으로 직접 빌드해 설치)가 필요하다.

```console
$ actionlint ci.yml
$
```

(종료 코드 0, 출력 없음 — 문제를 못 찾았다는 뜻이다.) 이 결과만으로는 `actionlint`가 실제로 뭔가를 검사하고 있다는 확신이 안 서서, 일부러 이 파일을 하나 망가뜨려 봤다 — `build-and-test` job(매트릭스가 없는 job)의 한 step에 `${{ matrix.sanitizer.nonexistent_field }}`라는, 그 job에는 존재하지 않는 컨텍스트 참조를 끼워 넣었다.

```console
$ actionlint ci_broken.yml
ci_broken.yml:21:17: property "sanitizer" is not defined in object type {} [expression]
   |
21 |         if: ${{ matrix.sanitizer.nonexistent_field }}
   |                 ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

(종료 코드 1.) `actionlint`가 이 job에는 `strategy.matrix`가 아예 없다는 것까지 알고 있어서, `matrix.sanitizer`라는 존재하지 않는 컨텍스트 참조를 정확한 줄·칸 번호와 함께 잡아냈다 — 이건 YAML 문법 오류가 아니라 GitHub Actions 표현식 언어에 대한 의미 분석이다. 이 정도로 검사가 실제로 동작한다는 걸 확인한 뒤, 원래 파일(`ci.yml`)로 되돌려 최종 검증을 마쳤다.

::: warn 이 절에서 확인한 것과 확인하지 못한 것
`actionlint`와 `yamllint`가 통과했다는 건 이 YAML의 **문법과 스키마**가 유효하다는 뜻이지, 실제로 GitHub 러너 위에서 `cmake`가 성공하고 `ctest`가 통과한다는 뜻이 아니다 — 이 콘텐츠는 실제 GitHub 저장소에 이 워크플로를 올려 실행한 적이 없다. 실제 CI 실행 결과(러너 종류에 따른 캐시 히트율, 빌드 시간, 새니타이저 job의 실제 로그)를 확인하려면 이 워크플로를 진짜 저장소의 `.github/workflows/`에 놓고 실제로 커밋·푸시해야 한다 — 그건 네 헥사포드 제어 소프트웨어 저장소에서 직접 해 볼 일이다.
:::

## 캐싱과 빌드 매트릭스

`actions/cache@v4`를 두 job 모두에 넣어 뒀던 이유를 이제 설명한다. [7.2](#/cmake-advanced)와 [7.6](#/googletest)에서 실측했듯 `FetchContent`는 첫 구성 시 Git 저장소를 통째로 clone한다 — `doctest`는 13MB, GoogleTest는 `gmock`까지 합쳐 전체 빌드에 16초가량이 걸렸다. CI는 매 커밋마다, 그것도 매트릭스로 나뉜 job 개수만큼 이 절차를 반복한다 — 캐시가 없으면 커밋 하나에 새니타이저 job 두 개가 각각 GoogleTest를 처음부터 다시 clone·빌드하게 된다.

`actions/cache@v4`는 `path`에 지정한 디렉터리(`build/_deps` — [7.2](#/cmake-advanced)에서 확인한 `FetchContent`의 다운로드·빌드 산출물 위치)를 `key`가 같은 한 재사용한다. 이 절의 `key: ${{ runner.os }}-deps-${{ hashFiles('**/CMakeLists.txt') }}`는 `CMakeLists.txt`의 내용이 바뀌지 않는 한 같은 키를 유지한다 — `FetchContent_Declare`의 `GIT_TAG`를 바꾸지 않는 이상 캐시가 계속 적중해서, 두 번째 커밋부터는 clone·빌드 과정 자체를 건너뛴다. 반대로 `GIT_TAG`를 새 버전으로 올리면 `CMakeLists.txt`가 바뀌었으니 해시가 달라지고, 캐시가 자동으로 무효화돼 새 버전을 다시 받는다 — 캐시가 오래된 의존성을 영영 붙들고 있는 사고를 이 키 설계가 막는다.

::: perf 캐싱의 이득은 국지적이다
캐싱이 줄이는 건 `FetchContent`가 다시 clone·빌드하는 시간이지, 프로젝트 자신의 소스 컴파일 시간이 아니다. 헥사포드 제어 소프트웨어 자신의 `.cpp` 파일은 캐시 여부와 무관하게 매 커밋 다시 컴파일된다(그래야 방금 커밋한 변경이 실제로 반영된다). 캐싱이 크게 이득을 보는 지점은 "의존성이 크고 자주 안 바뀌는데, job은 자주 도는" 상황이다 — 이 절의 GoogleTest가 정확히 그 사례다.
:::

**빌드 매트릭스**는 캐싱과 별개로, "같은 검증을 여러 조합에서 반복한다"는 아이디어를 새니타이저 축 말고 다른 축으로도 확장한 것이다. 컴파일러(`g++`/`clang++`)나 OS(`ubuntu-22.04`/`ubuntu-24.04`)를 매트릭스 축으로 추가하면, 한 워크플로 정의로 여러 조합을 동시에 검증한다.

```yaml title="컴파일러 매트릭스 확장 예시"
    strategy:
      matrix:
        compiler: [g++-13, clang++-18]
        os: [ubuntu-22.04, ubuntu-24.04]
```

이 축을 곱하면 `2 × 2 = 4`개의 job이 병렬로 생긴다. 헥사포드 프로젝트가 개발 머신(x86-64, g++)과 로봇 보드(ARM, [7.2](#/cmake-advanced)의 크로스 컴파일)를 둘 다 지원해야 한다면, 이 매트릭스 축에 아키텍처를 하나 더 추가해서 "이 커밋이 두 아키텍처 전부에서 여전히 컴파일되는가"를 매번 자동으로 확인할 수 있다 — 사람이 손으로 두 환경을 오가며 확인하던 걸 매트릭스 하나가 대신한다.

## 실패를 사람에게 알린다: 상태 체크와 PR 코멘트

워크플로가 실패해도 아무도 안 보면 소용없다. GitHub Actions는 워크플로의 job 하나하나를 **상태 체크(status check)**로 만들어 풀 리퀘스트 화면에 초록/빨강으로 바로 띄운다 — 리뷰어가 코드를 한 줄도 안 읽어도 "새니타이저 job이 빨간불이다"는 걸 그 자리에서 본다. 저장소 설정에서 이 체크들을 "필수(required)"로 지정하면, 실패한 체크가 있는 브랜치는 아예 병합 버튼이 비활성화된다 — 검증 통과가 "권장"이 아니라 "강제"가 되는 지점이다.

체크 자체 말고 더 적극적인 알림이 필요하면 실패한 job의 로그를 풀 리퀘스트에 코멘트로 남기는 액션(예: 서드파티 코멘트 액션)을 실패 시에만(`if: failure()`) 실행하도록 붙일 수 있다 — 리뷰어가 로그 페이지를 따로 열지 않아도 "어느 job이, 어떤 이유로 실패했는지" 요약이 풀 리퀘스트 타임라인에 바로 나타난다. 이 절은 이 알림 메커니즘의 존재와 원리만 짚는다 — 특정 서드파티 액션의 세부 설정은 이 책의 스코프 밖이다.

## 로보틱스 연결과 Part VII 종합

ROS 2 패키지들은 이 절에서 손으로 짠 CMake 구성·빌드 step을 매번 새로 적지 않는다. `ros-tooling/action-ros-ci` 같은 액션이 `colcon build`/`colcon test`([10.10](#/ament-colcon)에서 다룰 그 도구)를 GitHub Actions 위에서 대신 실행해 준다 — 이 절이 손으로 짠 `cmake -B build`/`ctest` step들을 ROS 2 워크스페이스 단위로 감싸는 헬퍼라고 보면 된다. 이 액션의 세부 옵션은 이 책의 스코프 밖이지만, "왜 이런 액션이 필요한가"는 이 절 전체가 이미 답했다 — ROS 2 워크스페이스도 결국 여러 패키지의 CMake 빌드를 묶은 것이고, 그 검증을 커밋마다 자동으로 돌리려면 이 절과 똑같은 문제(체크아웃, 캐싱, 매트릭스, 실패 알림)를 다시 풀어야 하기 때문이다.

이 절로 Part VII가 완결된다. [7.1](#/cmake-basics)·[7.2](#/cmake-advanced)의 CMake가 이 파이프라인의 구성·빌드 step 두 줄이 됐고, [7.3](#/package-managers)에서 다룬 의존성 관리의 재현성 문제는 이 절의 캐싱 키 설계로 이어졌다. [7.4](#/gdb)의 gdb는 이 파이프라인이 실패했을 때 그 실패를 사람이 다시 손으로 파고들 때 쓰는 도구로 남는다 — CI가 "무엇이 실패했는가"를 알려주면, gdb는 "왜 실패했는가"를 알려준다. [7.5](#/sanitizers)의 ASan/UBSan/TSan은 이 절의 `sanitizers` job 매트릭스 그 자체로 들어왔고, [7.6](#/googletest)의 `ctest`는 `build-and-test` job의 마지막 step이 됐다. [7.7](#/static-analysis)의 clang-tidy는 독립된 `static-analysis` job이 됐다. 이 Part가 여덟 절에 걸쳐 하나씩 익힌 도구들이, 이 절에서 하나의 YAML 파일 안에 나란히 선 job 세 개로 다시 만난다 — 개별 도구를 손에 익히는 것과, 그 도구들이 매 커밋 자동으로 함께 돌아가게 만드는 것은 서로 다른 기술이고, 이 절은 후자를 다룬 것이다.

## 요약

- 검증을 사람의 손에 맡기면 세 가지로 무너진다 — 깜빡하고 안 돌림, 팀원마다 다른 로컬 환경, 그리고 그 둘이 합쳐진 "내 컴퓨터에서는 되는데" 문제. CI는 검증을 커밋이라는 사건에 묶어 이 문제를 없앤다.
- GitHub Actions 워크플로는 이벤트(`on:`) → job(병렬, 독립 러너) → step(순차) 세 겹 구조다. `actions/checkout@v4`로 코드를 받고, 이후 step은 [7.1](#/cmake-basics)/[7.6](#/googletest)에서 손으로 치던 `cmake`/`ctest` 명령과 동일하다.
- [7.5](#/sanitizers)에서 실측한 "ASan과 TSan은 같은 빌드에 못 들어간다"는 제약이 CI 설계에 그대로 옮겨진다 — `strategy.matrix`로 새니타이저 조합을 job 두 개로 나누고, `fail-fast: false`로 한쪽 실패가 다른 쪽 결과를 가리지 않게 한다.
- [7.7](#/static-analysis)의 clang-tidy는 `CMAKE_EXPORT_COMPILE_COMMANDS=ON`으로 컴파일 데이터베이스를 만든 뒤 별도 job으로 돌린다 — 빌드·테스트 통과와 정적 분석 통과는 서로 독립된 신호다.
- 이 절의 워크플로 YAML은 실제 GitHub 러너에서 실행해 본 게 아니라, 이 환경에 설치한 `yamllint`(1.38.0)와 `actionlint`(v1.7.12)로 문법·스키마 유효성만 실제로 검증했다 — 일부러 망가뜨린 파일에서 `actionlint`가 존재하지 않는 매트릭스 컨텍스트 참조를 정확한 줄 번호로 잡아내는 것도 확인했다.
- `actions/cache@v4`는 `FetchContent`가 매 커밋 GoogleTest 같은 의존성을 다시 clone·빌드하지 않게 막는다 — 캐시 키를 `CMakeLists.txt`의 해시로 잡으면 의존성 버전이 바뀔 때만 캐시가 자동으로 무효화된다.
- 빌드 매트릭스는 새니타이저뿐 아니라 컴파일러·OS·아키텍처 축으로도 확장된다 — 하나의 워크플로 정의로 여러 조합을 동시에 검증한다.
- 실패한 job은 풀 리퀘스트의 상태 체크로 나타나고, 저장소 설정에서 "필수"로 지정하면 실패한 브랜치의 병합 자체를 막을 수 있다.
- ROS 2는 `ros-tooling/action-ros-ci` 같은 액션으로 `colcon build`/`colcon test`를 이 절의 원리 그대로 CI에 얹는다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4번은 판단 문제, 5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. "검증을 손으로 돌리면 왜 무너지는가"를 이 절이 든 세 가지 이유(깜빡함, 팀원 간 환경 차이, 그 결합) 중 두 가지 이상을 써서 설명하라.

2. `strategy.matrix`로 새니타이저 job을 나눌 때 `fail-fast: false`를 명시적으로 넣지 않으면 어떤 문제가 생기는지, [7.5](#/sanitizers)에서 ASan/TSan이 서로 독립된 종류의 버그를 잡는다는 사실과 연결해 설명하라.

3. (예측) 이 절의 `sanitizers` job에서 `CMAKE_BUILD_TYPE`을 실수로 `Release`로 바꿔 커밋했다고 하자. [7.2](#/cmake-advanced)의 실측(Release는 `-DNDEBUG`를 자동으로 붙인다)을 근거로, 이 새니타이저 job이 여전히 예전만큼 효과적으로 버그를 잡을지 예측하고 이유를 써라.

4. (판단) 이 절은 `yamllint`와 `actionlint` 둘 다 통과한 워크플로를 "검증됐다"고 부르지 않고 "문법·스키마가 유효하다"고만 불렀다. 실제로 이 워크플로가 헥사포드 저장소에서 의도대로 동작하는지 확인하려면 무엇을 추가로 해야 하는지 써라.

5. (실습, 코드 작성형) 이 절의 세 job(`build-and-test`, `sanitizers`, `static-analysis`)을 하나의 YAML 파일로 직접 타이핑하라. 그다음 `pip install yamllint`로 `yamllint <파일>`을 돌려 경고가 이 절과 같은 두 개(document-start, truthy)뿐인지 확인하고, 가능하면 `actionlint`(Go가 설치돼 있다면 `go install github.com/rhysd/actionlint/cmd/actionlint@latest`)까지 설치해서 에러 없이 통과하는지 확인하라. 마지막으로 아무 job의 `matrix.` 컨텍스트를 매트릭스가 없는 job에 억지로 참조시켜 `actionlint`가 정확히 그 줄에서 에러를 내는지까지 재현하라.
:::

::: answer 해설
1. 세 이유는 서로 독립적이면서도 겹친다. 사람이 깜빡하는 문제는 "한 줄만 고친 거라 안전하다"는 확신이 검증을 생략하게 만드는 것이고, 팀원 간 환경 차이 문제는 clang-tidy 버전이나 새니타이저 사용 습관이 사람마다 달라 같은 코드에 대해 서로 다른 결론이 나는 것이다. 이 둘이 합쳐지면 "작성자는 자기 환경에서 확인했다고 믿지만 그 확인 자체가 부실했거나 리뷰어의 환경과 다르다"는 "내 컴퓨터에서는 되는데" 상황이 나온다 — CI는 검증을 사람의 기억·환경이 아니라 커밋이라는 고정된 사건과 고정된 러너에 묶어서 이 셋을 동시에 없앤다.
2. `fail-fast: false`가 없으면 기본값(`true`)이 적용돼서, 매트릭스의 한 조합(예: `thread`)이 먼저 실패하는 순간 아직 실행 중이거나 대기 중인 다른 조합(`address+undefined`)의 실행이 자동으로 취소된다. [7.5](#/sanitizers)에서 ASan과 TSan은 서로 다른 종류의 버그(메모리 범위 대 스레드 동기화)를 잡는, 서로 독립적인 검사라고 확인했다 — `thread` job이 레이스를 하나 찾아 실패했다고 `address+undefined` job까지 취소되면, 그 커밋에 힙 버퍼 오버플로가 같이 섞여 있어도 확인할 기회 자체가 사라진다.
3. 여전히 컴파일은 되고 새니타이저 계측 자체(`-fsanitize=...` 플래그)는 그대로 작동하지만, `Release`가 자동으로 붙이는 `-DNDEBUG`가 `assert()`를 전부 지워 버린다 — 코드 안에 논리적 불변식을 검증하려고 넣어 둔 `assert` 호출들이 새니타이저 job 안에서 조용히 무력화된다는 뜻이다. ASan/TSan이 잡는 메모리·레이스 버그 자체는 여전히 잡히지만, `assert`로 잡으려던 논리 오류 쪽 방어선 하나가 이 job에서만 사라진 채로 통과되는 상황이 생긴다 — [7.2](#/cmake-advanced)가 강조했듯 새니타이저 빌드는 `CMAKE_BUILD_TYPE=Debug`로 고정해야 하는 이유가 여기 있다.
4. `yamllint`/`actionlint` 통과는 "이 파일이 GitHub Actions가 이해할 수 있는 형태"라는 것만 보장한다. 실제 동작을 확인하려면 이 워크플로 파일을 진짜 GitHub 저장소의 `.github/workflows/`에 커밋·푸시해서 실제 러너 위에서 `cmake`/`ctest`/새니타이저 빌드/clang-tidy가 각각 성공하는지, 캐시가 실제로 두 번째 실행부터 적중하는지, 풀 리퀘스트 화면에 상태 체크 세 개가 의도한 이름으로 나타나는지를 직접 관찰해야 한다 — 이 절이 정직하게 밝혔듯 그 실행 자체는 이 환경에서 하지 못했다.
5. 실제로 실행하면 `yamllint`는 이 절과 같은 두 경고(`missing document start`, `truthy value`)만 내고 종료 코드 0으로 끝나야 한다. `actionlint`가 설치돼 있다면 원본 파일은 출력 없이 종료 코드 0으로 끝나야 하고, 매트릭스가 없는 job에 `matrix.` 컨텍스트를 억지로 참조시킨 버전에서는 이 절의 `property "sanitizer" is not defined in object type {}`와 같은 형태의 에러가 정확한 줄·칸 번호와 함께 나와야 한다 — 문법 오류가 아니라 GitHub Actions 표현식에 대한 의미 분석이 실제로 동작한다는 걸 직접 확인하는 게 성공 기준이다.
:::

이 절의 워크플로 YAML은 실제 GitHub 저장소가 없어도 `yamllint`/`actionlint` 설치만으로 네 IDE 환경에서 검증까지는 그대로 재현할 수 있다 — 직접 타이핑해서 확인하라. 실제 러너 위에서의 동작(캐시 적중, 병렬 실행 시간, 상태 체크 화면)까지 보려면 헥사포드 제어 소프트웨어 저장소에 이 파일을 올려 실제로 커밋해 봐라. 기준 명령: `pip install yamllint && yamllint ci.yml`, 그리고 가능하면 `go install github.com/rhysd/actionlint/cmd/actionlint@latest && actionlint ci.yml`.

**다음 절**: [8.1 프로파일링: perf와 측정 방법론](#/profiling) — 빌드·테스트·새니타이저·정적 분석이 파이프라인으로 자동화됐으니, 이제 그 코드가 실제로 얼마나 빠른지 추측 대신 측정하는 단계로 넘어간다.
