# 7.6 GoogleTest로 테스트 작성

::: lead
지금까지 이 책의 모든 예제는 `main()` 안에서 값을 `std::cout`으로 찍고, 그 숫자가 맞는지는 당신이 눈으로 확인했다. 함수 하나, 값 하나일 때는 이 방식으로 충분하다. 그런데 헥사포드 다리 하나의 순기구학, 역기구학, 상태 추정, 좌표 변환 함수가 열 개, 스무 개로 늘고, 그 함수들을 서로 리팩터링하며 몇 주에 걸쳐 고쳐 나간다고 하자 — 매번 콘솔에 찍힌 숫자 수십 줄을 눈으로 다시 맞춰 보는 건 현실적으로 불가능하다. 이 절은 GoogleTest를 [7.2](#/cmake-advanced)의 FetchContent로 실제로 받아 프로젝트에 연결하고, `TEST()`/`TEST_F()`/`TEST_P()`로 검증을 코드 자체에 새겨서, `ctest` 한 번으로 전체 스위트가 스스로 맞는지 틀린지 답하게 만드는 법을 다룬다.
:::

## 눈으로 확인하는 방식이 무너지는 지점

`leg_reach()`라는 함수가 있다고 하자. 다리 세 세그먼트(coxa, femur, tibia) 길이를 더해 다리가 최대로 뻗을 수 있는 거리를 계산한다. 처음 짤 때는 `std::cout << leg_reach({0.05, 0.08, 0.12}) << '\n';`을 찍고 "0.25가 나와야 하는데 0.25가 나왔다"를 눈으로 확인하면 끝난다. 그런데 몇 주 뒤 캘리브레이션 보정을 넣는다고 이 함수를 고치다가, 실수로 상수 하나를 잘못 뺀다고 하자. 콘솔에는 여전히 숫자가 찍힌다 — `0.25`가 아니라 `0.24`가. 이 코드를 고친 사람이 그 순간 다른 열 개 함수도 같이 고치고 있었다면, `0.24`라는 숫자를 보고 "어, 이게 아닌데"라고 알아챌 확률은 급격히 떨어진다. 눈으로 확인하는 절차는 **바뀐 코드를 처음 짤 때는 통하지만, 이미 맞다고 확신했던 코드가 나중에 조용히 틀려지는 것(회귀, regression)은 못 잡는다** — 그 숫자가 맞는지 다시 보려면 애초에 "맞는 값이 뭐였는지"를 사람이 기억하고 있어야 하는데, 함수가 늘어날수록 그 기억은 유지가 안 된다.

단위 테스트는 이 문제를 뒤집는다. "이 입력엔 이 출력이 나와야 한다"는 판단을 사람의 기억이 아니라 코드 자체에 박아 넣고, 그 판단을 프로그램이 스스로 실행해서 맞는지 틀리는지 보고하게 만든다. 그러면 열 개든 백 개든 함수 수와 무관하게 검증에 드는 사람의 시간은 "명령 하나 실행"으로 고정된다 — 늘어나는 건 테스트 실행 시간이지, 사람이 눈으로 대조하는 시간이 아니다.

## GoogleTest를 FetchContent로 받아온다

GoogleTest는 apt에 `libgtest-dev`로도 있지만, 그 패키지는 헤더만 설치하고 라이브러리는 소스로만 주는 등 배포판마다 취급이 제각각이다. [7.2](#/cmake-advanced)에서 이미 다룬 `FetchContent`로 Git 저장소 태그를 직접 고정해서 받는 쪽이 어느 환경에서든 똑같은 버전을 재현한다. 실제로 이 환경에서 GoogleTest 저장소를 받아 빌드해 확인했다 — 이 환경은 `github.com`에 접근할 수 있었고, 추측이 아니라 실제 clone·빌드·실행까지 전부 확인한 결과다.

```cmake title="CMakeLists.txt — GoogleTest를 FetchContent로"
cmake_minimum_required(VERSION 3.16)
project(gtest_demo CXX)

include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.15.2
)
FetchContent_MakeAvailable(googletest)

add_executable(demo_tests test_math.cpp)
target_link_libraries(demo_tests PRIVATE GTest::gtest_main)
target_compile_features(demo_tests PRIVATE cxx_std_20)
```

```cpp title="test_math.cpp"
#include <gtest/gtest.h>

int add(int a, int b) { return a + b; }

TEST(MathTest, AddWorks) {
    EXPECT_EQ(add(2, 3), 5);
}
```

```console
$ cmake ..
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD - Success
-- Found Threads: TRUE
-- Configuring done (3.8s)
$ cmake --build .
[ 20%] Built target gtest
[ 40%] Built target gtest_main
[ 60%] Built target demo_tests
[ 80%] Built target gmock
[100%] Built target gmock_main
$ ./demo_tests
Running main() from .../build/_deps/googletest-src/googletest/src/gtest_main.cc
[==========] Running 1 test from 1 test suite.
[ RUN      ] MathTest.AddWorks
[       OK ] MathTest.AddWorks (0 ms)
[  PASSED  ] 1 test.
```

(g++ 13.3.0 / cmake 3.28.3 / Ubuntu 24.04 실측. `cmake ..` 구성에 3.8초가 걸린 건 그동안 실제로 저장소를 clone했기 때문이고, 캐시된 다음 구성부터는 즉시 끝난다. 전체 빌드는 16초가량 걸렸다 — `googletest`를 `FetchContent`로 받으면 `gtest`뿐 아니라 `gmock`까지 통째로 같이 딸려 와서 빌드되기 때문이다, 저장소 크기는 20MB.)

`GTest::gtest_main`을 링크한 게 핵심이다 — GoogleTest는 `GTest::gtest`(테스트 프레임워크 본체만)와 `GTest::gtest_main`(본체 + 표준 `main()` 구현) 두 타겟을 export한다. `gtest_main`을 쓰면 `int main() { return RUN_ALL_TESTS(); }`를 직접 안 써도 된다 — 위 예제에 `main()`이 없는데도 빌드·실행이 되는 이유다.

::: note
`GTest::gtest`만 링크하면 `main()`을 직접 짜야 한다. 여러 테스트 실행 파일에서 커맨드라인 인자를 직접 파싱하는 등 `main()`을 커스터마이즈해야 하는 특수한 경우가 아니면 `gtest_main`이 기본 선택이다.
:::

## TEST()로 단위 테스트를 짠다

`TEST(스위트이름, 테스트이름)` 매크로 하나가 테스트 함수 하나를 정의한다. 위 `MathTest.AddWorks`가 그 예다 — 스위트로 관련 테스트를 묶고, 이름으로 그 안의 개별 검증을 가리킨다. 테스트 본문 안에서 실제 검증은 `EXPECT_*`/`ASSERT_*` 계열 매크로가 한다. `EXPECT_EQ(a, b)`는 "a와 b가 같아야 한다"는 단언이고, 실패하면 그 파일:줄 번호와 함께 기대값·실제값을 리포트한다. `TEST()`는 클래스도 상속도 없이 자유 함수 하나로 끝나므로, 공유 준비 상태가 필요 없는 독립적인 검증에 적합하다 — 공유 상태가 필요해지면 아래 `TEST_F()`로 넘어간다.

## EXPECT_EQ와 ASSERT_EQ: 실패해도 계속 vs 그 자리에서 중단

`EXPECT_*`와 `ASSERT_*`는 검증 내용은 같지만 **실패했을 때의 동작이 다르다.** `EXPECT_*`는 실패를 기록하고도 테스트 함수의 나머지 줄을 계속 실행한다. `ASSERT_*`는 실패하는 즉시 그 자리에서 함수를 `return`한다 — 이후 줄은 실행되지 않는다. 이 차이를 실제로 버그가 있는 함수로 만들어 확인했다.

```cpp title="test_ik.cpp — 일부러 버그를 심은 leg_reach()"
#include <gtest/gtest.h>
#include <vector>

// 헥사포드 다리 하나의 길이 목록에서 리치(reach)를 계산한다.
double leg_reach(const std::vector<double>& segment_lengths) {
    double total = 0.0;
    for (double len : segment_lengths) total += len;
    return total - 0.01; // 버그: 캘리브레이션 상수를 잘못 뺀다
}

TEST(LegReachTest, ExpectContinuesAfterFailure) {
    EXPECT_EQ(leg_reach({0.05, 0.08, 0.12}), 0.25);
    EXPECT_EQ(leg_reach({}), 0.0);
    // EXPECT는 위 두 줄이 실패해도 여기까지 반드시 실행한다.
    EXPECT_GT(leg_reach({0.05, 0.08, 0.12}), 0.0);
}

TEST(LegReachTest, AssertStopsAtFirstFailure) {
    ASSERT_EQ(leg_reach({0.05, 0.08, 0.12}), 0.25);
    EXPECT_GT(leg_reach({0.05, 0.08, 0.12}), 100.0); // ASSERT가 실패하면 이 줄은 실행 안 됨
}
```

```console
$ ./demo_tests
[ RUN      ] LegReachTest.ExpectContinuesAfterFailure
test_ik.cpp:15: Failure
Expected equality of these values:
  leg_reach({0.05, 0.08, 0.12})
    Which is: 0.24
  0.25

test_ik.cpp:16: Failure
Expected equality of these values:
  leg_reach({})
    Which is: -0.01
  0.0
    Which is: 0

[  FAILED  ] LegReachTest.ExpectContinuesAfterFailure (0 ms)
[ RUN      ] LegReachTest.AssertStopsAtFirstFailure
test_ik.cpp:23: Failure
Expected equality of these values:
  leg_reach({0.05, 0.08, 0.12})
    Which is: 0.24
  0.25

[  FAILED  ] LegReachTest.AssertStopsAtFirstFailure (0 ms)
[  FAILED  ] 2 tests, listed below:
[  FAILED  ] LegReachTest.ExpectContinuesAfterFailure
[  FAILED  ] LegReachTest.AssertStopsAtFirstFailure

 2 FAILED TESTS
```

(g++ 13.3.0 / GoogleTest v1.15.2 실측.) 이 출력이 두 매크로의 차이를 정확히 보여준다. `ExpectContinuesAfterFailure`에서는 15번 줄, 16번 줄 **둘 다** 실패 리포트가 찍혔다 — 첫 `EXPECT_EQ`가 실패했는데도 함수가 끝까지 실행돼서 두 번째 `EXPECT_EQ`까지 평가됐다는 뜻이다(세 번째 `EXPECT_GT`는 통과라 리포트에 안 찍혔다). 반면 `AssertStopsAtFirstFailure`에서는 23번 줄(`ASSERT_EQ`) 실패 리포트 **하나만** 찍히고 끝났다 — 그다음 줄의 `EXPECT_GT(..., 100.0)`은 명백히 실패할 조건인데도 리포트에 아예 나타나지 않는다, 실행되지 않았기 때문이다. 실패 리포트 자체도 눈여겨볼 부분이다 — 파일명과 줄 번호(`test_ik.cpp:15`), 실제로 평가된 식(`leg_reach({0.05, 0.08, 0.12})`), 그 결과값(`Which is: 0.24`), 기대값(`0.25`)이 전부 한 블록에 나온다. 콘솔에 숫자만 찍던 방식과 달리, **어디가, 무엇을 기대했다가, 실제로 무엇을 받았는지**가 코드를 다시 안 봐도 리포트만으로 드러난다.

::: tip
`ASSERT_*`는 그다음 코드가 실패를 전제로 하면 위험해지는 상황에 쓴다 — 예를 들어 포인터가 `nullptr`이 아님을 `ASSERT_NE`로 확인한 다음에야 그 포인터를 역참조하는 식이다. 그 자리에서 멈추지 않으면 테스트 자체가 크래시로 죽는다. 반대로 서로 독립적인 여러 필드를 한 테스트에서 검증할 때는 `EXPECT_*`를 써서 한 번 실행에 모든 실패를 한꺼번에 리포트받는 게 낫다 — 하나 고치고 다시 돌리고 또 하나 고치고 다시 돌리는 걸 피할 수 있다.
:::

## 테스트 픽스처: TEST_F, SetUp/TearDown

여러 테스트가 똑같은 준비 상태를 공유해야 할 때가 있다 — 매번 같은 `HexLeg` 객체를 만들고 끝나면 정리하는 식이다. `TEST()`로 이걸 하면 테스트마다 준비 코드를 복사-붙여넣기 하게 된다. `::testing::Test`를 상속한 **픽스처** 클래스가 이 중복을 없앤다. `SetUp()`은 각 테스트 시작 직전에, `TearDown()`은 각 테스트가 끝난 직후에 자동으로 호출된다 — 생성자/소멸자로도 같은 걸 할 수 있지만, `SetUp`/`TearDown`은 실패해도 예외를 던지지 않고 `ASSERT_*`로 준비 단계 자체를 검증할 수 있다는 차이가 있다.

```cpp title="test_leg.cpp — 픽스처"
#include <gtest/gtest.h>
#include <memory>

class HexLeg {
public:
    HexLeg(double coxa, double femur, double tibia)
        : coxa_(coxa), femur_(femur), tibia_(tibia) {}
    double reach() const { return coxa_ + femur_ + tibia_; }
private:
    double coxa_, femur_, tibia_;
};

class HexLegTest : public ::testing::Test {
protected:
    void SetUp() override {
        leg_ = std::make_unique<HexLeg>(0.05, 0.08, 0.12);
    }
    void TearDown() override {
        leg_.reset();
    }
    std::unique_ptr<HexLeg> leg_;
};

TEST_F(HexLegTest, ReachIsSumOfSegments) {
    EXPECT_DOUBLE_EQ(leg_->reach(), 0.25);
}

TEST_F(HexLegTest, ReachIsPositive) {
    EXPECT_GT(leg_->reach(), 0.0);
}
```

```console
$ ./leg_tests
[ RUN      ] HexLegTest.ReachIsSumOfSegments
[SetUp] 다리 인스턴스 생성
[TearDown] 다리 인스턴스 해제
[       OK ] HexLegTest.ReachIsSumOfSegments (0 ms)
[ RUN      ] HexLegTest.ReachIsPositive
[SetUp] 다리 인스턴스 생성
[TearDown] 다리 인스턴스 해제
[       OK ] HexLegTest.ReachIsPositive (0 ms)
[  PASSED  ] 5 tests.
```

(g++ 13.3.0 / GoogleTest v1.15.2 실측, `puts()`로 SetUp/TearDown 호출 지점을 로그로 남겨 확인했다.) `SetUp`/`TearDown`이 테스트 **하나마다** 새로 호출된다는 게 이 출력의 핵심이다 — `HexLegTest` 픽스처를 쓰는 두 테스트가 서로 같은 `leg_` 객체를 공유하는 게 아니라, 테스트마다 새로 만들고 새로 정리한다. 이게 중요하다 — 한 테스트가 `leg_`의 상태를 바꿔도 다른 테스트에 영향이 새지 않는다, 각 테스트는 서로 독립적이어야 한다는 GoogleTest의 기본 전제다.

## 파라미터화 테스트: TEST_P, INSTANTIATE_TEST_SUITE_P

같은 검증 로직을 입력값만 바꿔 여러 번 돌리고 싶을 때 `TEST_F()`를 입력값 개수만큼 복사하는 건 유지보수가 나쁘다. `TEST_P()`는 `GetParam()`으로 파라미터 하나를 받는 테스트 템플릿을 한 번만 정의하고, `INSTANTIATE_TEST_SUITE_P()`가 그 템플릿을 실제 값 목록에 대해 찍어낸다.

```cpp title="test_leg.cpp — 파라미터화"
struct LegParams {
    double coxa, femur, tibia, expected_reach;
};

class HexLegParamTest : public ::testing::TestWithParam<LegParams> {};

TEST_P(HexLegParamTest, ReachMatchesExpected) {
    const auto p = GetParam();
    HexLeg leg(p.coxa, p.femur, p.tibia);
    EXPECT_NEAR(leg.reach(), p.expected_reach, 1e-9);
}

INSTANTIATE_TEST_SUITE_P(
    VariousLegConfigs,
    HexLegParamTest,
    ::testing::Values(
        LegParams{0.05, 0.08, 0.12, 0.25},
        LegParams{0.03, 0.06, 0.09, 0.18},
        LegParams{0.10, 0.10, 0.10, 0.30}
    ),
    [](const ::testing::TestParamInfo<LegParams>& info) {
        return "reach_" + std::to_string(static_cast<int>(info.param.expected_reach * 1000));
    }
);
```

```console
$ ./leg_tests --gtest_list_tests
VariousLegConfigs/HexLegParamTest.
  ReachMatchesExpected/reach_250  # GetParam() = 32-byte object <9A-99 99-99 ...>
  ReachMatchesExpected/reach_180  # GetParam() = 32-byte object <B8-1E 85-EB ...>
  ReachMatchesExpected/reach_300  # GetParam() = 32-byte object <9A-99 99-99 ...>
```

(g++ 13.3.0 / GoogleTest v1.15.2 실측.) 세 번째 인자로 넘긴 람다가 각 케이스에 `reach_250`, `reach_180`, `reach_300`이라는 읽을 수 있는 이름을 붙인다. 이 이름 붙이는 함수를 생략해 봤는데, 그러자 각 케이스 이름이 그냥 `/0`, `/1`, `/2`로 나왔다 — 어느 케이스가 실패했는지 이름만 보고는 알 수 없는 상태였다.

::: warn
이름 붙이는 함수를 넣어도 `--gtest_list_tests`/`ctest -N` 출력에는 `# GetParam() = 32-byte object <9A-99 ...>`라는 꼬리표가 그대로 따라붙는다 — 실제로 이 환경에서 확인한 그대로다. `LegParams`에 `PrintTo()` 오버로드를 안 만들어 줬기 때문에, GoogleTest가 구조체를 사람이 읽을 값으로 못 풀고 원시 바이트를 덤프한 것이다. 테스트 이름(`reach_250`)과 이 진단용 꼬리표는 별개다 — 이름은 람다가 붙였고, 꼬리표는 GoogleTest가 파라미터 타입을 못 알아볼 때 자동으로 붙이는 것이다. 신경 쓰인다면 `PrintTo(const LegParams&, std::ostream*)`을 직접 정의해서 없앨 수 있다.
:::

## ctest와 GoogleTest 통합: enable_testing(), gtest_discover_tests()

지금까지는 테스트 실행 파일을 직접 실행했다. CMake 프로젝트가 커지면 테스트 실행 파일이 여러 개 생기고, 그걸 하나하나 실행하는 대신 `ctest` 한 번으로 전부 돌리고 싶어진다. `enable_testing()`으로 프로젝트에 테스트 기능을 켜고, `include(GoogleTest)` 다음 `gtest_discover_tests(타겟)`을 호출하면, CMake가 빌드된 실행 파일을 실제로 한 번 실행해서(`--gtest_list_tests`) 그 안의 개별 `TEST`/`TEST_F`/`TEST_P` 케이스를 하나하나 별도의 `ctest` 테스트로 등록한다 — 실행 파일 하나가 아니라 **케이스 하나하나**가 ctest 목록의 항목이 된다는 게 핵심이다.

```cmake title="CMakeLists.txt — ctest 통합"
cmake_minimum_required(VERSION 3.16)
project(gtest_fixture_param CXX)
enable_testing()

include(FetchContent)
FetchContent_Declare(googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.15.2)
FetchContent_MakeAvailable(googletest)
include(GoogleTest)

add_executable(leg_tests test_leg.cpp)
target_link_libraries(leg_tests PRIVATE GTest::gtest_main)
target_compile_features(leg_tests PRIVATE cxx_std_20)

gtest_discover_tests(leg_tests)
```

```console
$ ctest
Test project .../build
    Start 1: HexLegTest.ReachIsSumOfSegments
1/5 Test #1: HexLegTest.ReachIsSumOfSegments ......   Passed    0.01 sec
    Start 2: HexLegTest.ReachIsPositive
2/5 Test #2: HexLegTest.ReachIsPositive ...........   Passed    0.01 sec
    Start 3: VariousLegConfigs/HexLegParamTest.ReachMatchesExpected/reach_250 ...   Passed
    Start 4: VariousLegConfigs/HexLegParamTest.ReachMatchesExpected/reach_180 ...   Passed
    Start 5: VariousLegConfigs/HexLegParamTest.ReachMatchesExpected/reach_300 ...   Passed

100% tests passed, 0 tests failed out of 5
Total Test time (real) =   0.03 sec
```

앞서 EXPECT/ASSERT 버그를 심었던 `demo_tests`에 같은 방식으로 `gtest_discover_tests()`를 걸고 `ctest --output-on-failure`로 돌리면, 실패한 케이스만 실제 GoogleTest 출력을 그대로 펼쳐 보여준다.

```console
$ ctest --output-on-failure
    Start 1: LegReachTest.ExpectContinuesAfterFailure
1/2 Test #1: LegReachTest.ExpectContinuesAfterFailure ...***Failed    0.00 sec
test_ik.cpp:15: Failure
Expected equality of these values:
  leg_reach({0.05, 0.08, 0.12})
    Which is: 0.24
  0.25
...
[  FAILED  ] 1 test, listed below:
[  FAILED  ] LegReachTest.ExpectContinuesAfterFailure

    Start 2: LegReachTest.AssertStopsAtFirstFailure
2/2 Test #2: LegReachTest.AssertStopsAtFirstFailure .....***Failed    0.00 sec
...
0% tests passed, 2 tests failed out of 2
```

(g++ 13.3.0 / cmake 3.28.3 / GoogleTest v1.15.2 실측, exit code 8.) `gtest_discover_tests()`가 실행 파일을 빌드가 끝난 뒤 한 번 실행해서 케이스 목록을 얻어 오기 때문에, 테스트를 추가하거나 이름을 바꿔도 `CMakeLists.txt`를 다시 손볼 필요가 없다 — 다음 빌드에서 자동으로 다시 갱신된다. `add_test(NAME 테스트 COMMAND 실행파일)`로 직접 등록하는 방법도 있는데, 이 경우는 실행 파일 전체가 ctest의 테스트 **하나**로 잡힌다 — 그 안의 `TEST` 케이스 중 하나라도 실패하면 실행 파일 전체가 통째로 "실패"로 보고되고, 어느 케이스가 실패했는지는 `--output-on-failure`로 로그를 펼쳐야 알 수 있다. 케이스 단위로 pass/fail을 따로 보고 싶으면 `gtest_discover_tests()`가 실질적으로 유일한 선택이다.

## 목(mock)의 기초: MOCK_METHOD와 EXPECT_CALL

지금까지 테스트한 함수는 전부 순수 계산이었다 — 입력을 넣으면 출력이 나오고 부수효과가 없다. 그런데 실제 액추에이터를 구동하는 코드는 테스트에서 진짜 서보를 돌릴 수 없다. GoogleTest는 `googletest`를 받을 때 `googlemock`도 같이 딸려 온다(위 빌드 로그의 `gmock`/`gmock_main` 타겟이 그 증거다) — 인터페이스를 흉내 낸 가짜 객체(mock)를 만들고, "이 메서드가 이 인자로 정확히 몇 번 호출됐는가"를 검증하는 도구다.

```cpp title="test_actuator.cpp"
#include <gmock/gmock.h>
#include <gtest/gtest.h>

class Actuator {
public:
    virtual ~Actuator() = default;
    virtual void set_angle(double radians) = 0;
};

class MockActuator : public Actuator {
public:
    MOCK_METHOD(void, set_angle, (double radians), (override));
};

void move_leg(Actuator& coxa, Actuator& femur, Actuator& tibia,
              double a, double b, double c) {
    coxa.set_angle(a);
    femur.set_angle(b);
    tibia.set_angle(c);
}

TEST(MoveLegTest, CallsEachActuatorExactlyOnce) {
    MockActuator coxa, femur, tibia;
    EXPECT_CALL(coxa, set_angle(0.1)).Times(1);
    EXPECT_CALL(femur, set_angle(0.2)).Times(1);
    EXPECT_CALL(tibia, set_angle(0.3)).Times(1);

    move_leg(coxa, femur, tibia, 0.1, 0.2, 0.3);
}
```

이 테스트는 실제로 통과했다(`GTest::gmock_main` 링크, g++ 13.3.0 실측). 여기서 `femur`에 넘기는 각도를 `0.2`에서 실수로 `0.99`로 바꿔서(호출 코드가 잘못됐다고 가정하고) 다시 돌리면, gmock이 기대와 실제 호출을 정확히 대조해 리포트한다.

```console
$ ./mock_tests
unknown file: Failure
Unexpected mock function call - returning directly.
    Function call: set_angle(0.99)
Google Mock tried the following 1 expectation, but it didn't match:
test_actuator.cpp:27: EXPECT_CALL(femur, set_angle(0.2))...
  Expected arg #0: is equal to 0.2
           Actual: 0.99
         Expected: to be called once
           Actual: never called - unsatisfied and active
[  FAILED  ] MoveLegTest.CallsEachActuatorExactlyOnce (0 ms)
```

(g++ 13.3.0 / GoogleTest v1.15.2 실측.) `set_angle(0.99)`라는 호출이 들어왔는데 어느 `EXPECT_CALL`과도 안 맞아서 "기대하지 않은 호출"로 처리됐고, 동시에 `femur, set_angle(0.2)`라는 기대는 끝내 한 번도 만족되지 않은 채로 리포트에 남았다 — 값 하나가 다르다는 걸 인자 단위로 정확히 짚어 준다. 픽스처·파라미터화가 "입력과 출력"을 검증하는 도구라면, mock은 "이 객체가 어떻게 호출되었는가"를 검증하는 도구다. 이 절에서는 여기까지만 다룬다 — `NiceMock`, `StrictMock`, 인자 매처(matcher) 조합 같은 고급 사용법은 별도로 깊이 다룰 만한 분량이라 이 책의 스코프 밖에 남겨 둔다.

## 로보틱스 연결: IK 솔버의 경계 조건을 테스트로 고정한다

[9.5 역기구학](#/inverse-kinematics)에서 실제로 짤 헥사포드 3자유도 다리 IK 솔버는 이 절에서 본 `leg_reach()`보다 훨씬 복잡한 삼각함수 계산으로 이뤄진다 — 그리고 이 절에서 실제로 만들어 본 버그(`0.25`가 나와야 할 자리에 `0.24`)가 정확히 그 계산에서 벌어질 수 있는 종류의 실수다. 부호 하나, 상수 하나를 잘못 넣어도 최종 출력은 여전히 "그럴듯한 숫자"로 보인다 — 다리가 아예 안 움직이는 게 아니라 목표 지점에서 몇 밀리미터 어긋난 자리로 움직이는 식이라서, 콘솔에 찍힌 숫자만 봐서는 틀렸다는 게 안 보인다. 게다가 IK는 **경계 조건**에서 특히 잘 깨진다 — 다리가 완전히 펴진 자세(도달 거리의 한계), 관절 각도가 0인 자세, 목표 지점이 물리적으로 도달 불가능한 자리 같은 지점이다. 이런 경계는 손으로 매번 시도해 보기도 번거롭고, 리팩터링 한 번에 조용히 깨지기도 쉽다. `TEST_P()`로 "완전히 편 자세", "완전히 접은 자세", "도달 불가능한 목표" 같은 경계 케이스를 나열해 두면, 그 다음 어떤 리팩터링을 하든 `ctest` 한 번이 그 경계들이 여전히 맞는지 즉시 답해 준다.

## 요약

- 함수 수가 늘면 `main()`에서 값을 찍고 눈으로 확인하는 방식은 회귀(이미 맞던 코드가 조용히 틀려지는 것)를 못 잡는다 — 판단을 코드에 박아 자동으로 실행해야 한다.
- GoogleTest는 `FetchContent_Declare` + `FetchContent_MakeAvailable`로 받고, `GTest::gtest_main`을 링크하면 `main()` 없이 바로 빌드된다 — 이 환경에서 v1.15.2를 실제로 받아 빌드·실행까지 확인했다.
- `EXPECT_EQ`는 실패해도 테스트 함수를 끝까지 실행하고, `ASSERT_EQ`는 실패한 그 줄에서 함수를 종료한다 — 실제로 버그를 심어 두 매크로의 리포트가 어떻게 다른지 실측했다.
- `TEST_F` + `SetUp`/`TearDown`으로 여러 테스트가 공유하는 준비 상태를 캡슐화한다 — `SetUp`/`TearDown`은 테스트 하나마다 새로 호출돼 테스트 간 독립성을 지킨다.
- `TEST_P` + `INSTANTIATE_TEST_SUITE_P`로 같은 검증 로직을 여러 입력값에 반복 적용한다 — 세 번째 인자로 이름 붙이는 함수를 안 넣으면 케이스 이름이 `/0`, `/1`처럼 나온다.
- `enable_testing()` + `include(GoogleTest)` + `gtest_discover_tests()`로 `TEST` 케이스 하나하나가 `ctest`의 개별 항목으로 등록된다 — `add_test()`로 직접 등록하면 실행 파일 전체가 테스트 하나로 뭉뚱그려진다.
- `googletest`를 받으면 `googlemock`도 같이 온다 — `MOCK_METHOD`/`EXPECT_CALL`로 인터페이스 호출 자체(무엇을, 몇 번, 어떤 인자로)를 검증할 수 있다.

::: quiz 연습문제
1. `EXPECT_EQ`와 `ASSERT_EQ`가 똑같이 실패하는 상황에서, 그 다음 줄이 실행되는지 여부가 왜 다른지 이 절의 실측 결과(파일:줄 번호 리포트가 몇 개 찍혔는지)를 근거로 설명하라.
2. `TEST_F`의 `SetUp`/`TearDown`이 테스트 스위트 전체에 한 번만 호출되는 게 아니라 테스트 케이스마다 호출된다는 게 왜 중요한지, 한 테스트가 다른 테스트의 상태를 오염시키는 시나리오로 설명하라.
3. `gtest_discover_tests()`로 등록한 테스트와 `add_test()`로 직접 등록한 테스트가 `ctest` 결과 화면에서 어떻게 다르게 보이는지 — 실패했을 때 어느 쪽이 "몇 번째 케이스가 실패했는지"를 더 빨리 알려주는지 답하라.
4. (예측) `TEST_P`의 `INSTANTIATE_TEST_SUITE_P`에서 이름 붙이는 세 번째 인자(람다)를 완전히 빼면 `ctest -N` 출력의 테스트 이름이 어떻게 나올지 이 절의 실측을 근거로 예측하라.
5. (실습, 코드 작성형) 이 절의 `leg_tests` 프로젝트를 네 IDE에서 직접 타이핑해서 구성하고, `HexLegParamTest`에 케이스 하나를 더 추가하라 — coxa/femur/tibia 길이를 아무 값이나 넣고 `expected_reach`를 **일부러 틀리게** 적어서 그 케이스만 실패하는지 `ctest --output-on-failure`로 확인하라. 그다음 값을 바로잡아 `ctest`가 전부 통과하는지까지 확인하라. 기준 명령: `cmake .. && cmake --build . && ctest --output-on-failure`.
:::

::: answer 해설
1. `EXPECT_EQ`가 실패한 `ExpectContinuesAfterFailure` 테스트에서는 15번, 16번 줄 리포트가 **둘 다** 찍혔다 — 첫 실패 후에도 함수가 계속 실행돼 두 번째 검증까지 평가됐다는 뜻이다. `ASSERT_EQ`가 실패한 `AssertStopsAtFirstFailure`에서는 23번 줄 리포트 **하나만** 찍혔다 — `ASSERT_EQ`가 실패하는 즉시 함수가 `return`돼서, 명백히 실패할 다음 줄(`EXPECT_GT(..., 100.0)`)이 아예 평가되지 않았기 때문이다.
2. `SetUp`이 테스트 스위트당 한 번만 불렸다면, 첫 테스트가 픽스처 객체의 상태를 바꿔 놓은 채로 두 번째 테스트가 그 바뀐 상태를 물려받게 된다 — 두 번째 테스트가 실패했을 때 그게 두 번째 테스트 자체의 버그인지, 첫 번째 테스트가 남긴 부작용인지 구분할 수 없어진다. 테스트마다 새로 `SetUp`하면 각 테스트가 항상 같은 초기 상태에서 출발한다는 게 보장되고, 실행 순서를 바꿔도 결과가 같아야 한다.
3. `gtest_discover_tests()`로 등록하면 `ctest` 결과에 `HexLegTest.ReachIsSumOfSegments`처럼 케이스 이름이 각각 하나의 항목으로 나온다 — 실패하면 정확히 어느 케이스인지 목록에서 바로 보인다. `add_test()`로 실행 파일 전체를 등록하면 `ctest` 목록에는 실행 파일 이름 하나만 있고, 그 안의 케이스 중 하나만 실패해도 그 항목 전체가 "Failed"로 뜬다 — 어느 케이스인지 알려면 `--output-on-failure`로 GoogleTest의 원본 출력을 펼쳐서 직접 찾아야 한다.
4. 이 절에서 실제로 이름 함수를 넣기 전 상태를 확인했다 — 이름 함수가 없으면 `INSTANTIATE_TEST_SUITE_P`가 케이스를 등록 순서대로 `/0`, `/1`, `/2`처럼 숫자만 붙여 이름 짓는다. `VariousLegConfigs/HexLegParamTest.ReachMatchesExpected/0`, `.../1`, `.../2` 형태로 나와야 한다.
5. 추가한 케이스의 `expected_reach`를 실제 `coxa+femur+tibia` 합과 다르게 적으면, `EXPECT_NEAR(leg.reach(), p.expected_reach, 1e-9)`가 그 케이스에서만 실패하고 나머지 케이스는 그대로 통과해야 한다 — `ctest --output-on-failure`가 실패한 그 하나의 케이스 이름과 기대값·실제값을 정확히 짚어 준다. 값을 바로잡은 뒤에는 `ctest`가 다시 전부 `Passed`로 나와야 한다.
:::

**다음 절**: [7.7 clang-tidy와 정적 분석](#/static-analysis) — 테스트가 "동작이 맞는가"를 검증한다면, 정적 분석은 실행조차 안 해 보고 코드 자체에서 냄새 나는 패턴을 커밋 전에 잡는다.
