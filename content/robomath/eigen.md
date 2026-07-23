# 9.1 Eigen: 선형대수를 C++로

::: lead
Part IX부터는 로보틱스 도메인이다. 그 첫 상대가 선형대수 라이브러리인 이유는 단순하다 — 좌표 변환, 자코비안, 칼만 필터, 헥사포드 다리의 역기구학까지, 앞으로 나올 수학이 전부 행렬 연산이기 때문이다. 이 절은 Eigen의 기본기(타입, 초기화, 블록 연산)를 잡은 뒤, [8.6](#/benchmarking)이 예고한 검증을 실행한다: "표현식 템플릿이 임시 객체를 없애 준다"는 Eigen의 성능 주장을 이 환경에서 실측으로 확인하고, [8.5](#/simd)의 "Eigen이 SIMD를 공짜로 준다"를 같은 소스·세 개의 빌드로 숫자로 확인한다. 그리고 그 설계가 만드는 두 개의 유명한 함정 — `auto`와의 충돌, 앨리어싱 — 을 직접 재현한다.
:::

## 손으로 짠 행렬 곱의 청구서

3×3 회전행렬과 벡터의 곱은 이중 루프 아홉 줄이면 된다. `double R[3][3]`, `double p[3]`, 루프 두 개 — Part I의 지식만으로 짤 수 있고, 실제로 동작한다. 문제는 그다음부터다.

첫째, **표현력의 붕괴.** 회전 하나는 아홉 줄이지만, 로봇 수학은 회전 하나로 끝나지 않는다. "몸통 프레임의 점을 다리 프레임으로 옮기고, 자코비안 전치를 곱하고, 정규화한다"를 원시 배열과 루프로 쓰면 코드에서 수식이 사라진다 — 수식이 안 보이는 수학 코드는 리뷰할 수도, 디버깅할 수도 없다.

둘째, **정확성의 부담.** 역행렬, 분해, 최소제곱 — 수치적으로 제대로 구현하기 어려운 연산들이 바로 뒤에 줄 서 있다. 3×3 역행렬을 여인수로 직접 짜는 것과, 수십 년 검증된 구현을 쓰는 것 사이의 선택이다([9.8](#/numerics)에서 부동소수점이 왜 이 검증을 필요하게 만드는지 다룬다).

셋째, **성능.** [8.5](#/simd)에서 봤듯 행렬 연산은 SIMD의 주 무대인데, 손으로 짠 루프가 벡터화·캐시 블로킹까지 도달하려면 Part VIII 전체를 매번 다시 적용해야 한다.

이 셋을 한 번에 해결하는 것이 Eigen이다 — C++ 템플릿으로 구현된 선형대수 라이브러리로, 이 절부터 Part IX~XI의 모든 수학이 이 위에서 돈다.

::: note Eigen은 ROS 2 생태계의 사실상 표준이다
선택의 여지가 별로 없다는 뜻이기도 하다. tf2의 C++ 변환 타입 연동(`tf2_eigen`), MoveIt2의 포즈 표현(`Eigen::Isometry3d`), PCL의 포인트클라우드 변환, `ros2_control`을 쓰는 수많은 컨트롤러가 전부 Eigen 타입을 주고받는다. ROS 2 Humble을 설치하면 Eigen은 의존성으로 이미 깔려 있다. 즉 Eigen을 익히는 것은 라이브러리 하나를 고르는 일이 아니라 로봇 C++ 코드의 공용어를 익히는 일이다 — [10.7](#/tf2)과 [11.4](#/moveit2)에서 이 타입들을 그대로 다시 만난다.
:::

## 설치는 없다: 헤더 온리 라이브러리

Ubuntu에서 `apt install libeigen3-dev` 한 줄이면 끝인데, 이 패키지가 설치하는 것을 들여다보면 특이한 점이 있다 — **라이브러리 파일이 하나도 없다.**

```console
$ dpkg -L libeigen3-dev | grep -cE '\.(so|a)$'
0
$ ls /usr/include/eigen3
Eigen  signature_of_eigen3_matrix_library  unsupported
```

(Eigen 3.4.0 / Ubuntu 24.04 실측.) `.so`도 `.a`도 0개. 전부 헤더다. 그래서 링크 플래그 없이 include 경로 하나로 컴파일이 끝난다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 basic.cpp -o basic && ./basic
```

`-l` 옵션이 하나도 없다는 것에 주목하라 — [1.1](#/compile-model)에서 배운 링크 단계에 Eigen의 몫이 없다. 이유는 [4.3](#/template-mechanics)이 이미 설명했다. Eigen은 전체가 클래스 템플릿이고, 템플릿은 호출부의 타입을 알아야 코드를 찍어낼 수 있으므로 정의 전체가 include를 통해 사용자의 번역 단위 안으로 들어와야 한다. 미리 컴파일해 둘 `.so`가 존재할 수 없는 구조다. 그 대가도 [4.3](#/template-mechanics)에서 실측했다 — `#include <Eigen/Dense>` 한 줄이 번역 단위당 컴파일 시간을 초 단위로 늘린다. 헤더 온리는 "배포가 쉽다"와 "컴파일이 느리다"의 교환이다.

::: tip 경고는 -isystem으로, CMake는 Eigen3::Eigen으로
`-march=native` + `-Wall -Wextra`로 컴파일하면 Eigen 3.4.0 자신의 AVX-512 헤더에서 `unused variable` 경고가 3개 나온다(실측). 서드파티 헤더의 경고는 `-I` 대신 `-isystem /usr/include/eigen3`으로 include하면 사라진다(실측: 3개 → 0개). CMake에서는 `find_package(Eigen3 REQUIRED)` 후 `target_link_libraries(app PRIVATE Eigen3::Eigen)` — 이 타겟의 정체는 [7.1](#/cmake-basics)에서 배운 **INTERFACE 라이브러리**다(`Eigen3Targets.cmake`에 `INTERFACE IMPORTED`로 정의돼 있는 것을 확인했다). 링크할 실물 없이 include 경로만 전파하는, 헤더 온리의 CMake식 표현이다.
:::

## Matrix3d와 MatrixXd: 크기를 타입에 새길 것인가

Eigen의 모든 행렬은 템플릿 `Eigen::Matrix<Scalar, Rows, Cols>`의 인스턴스이고, 자주 쓰는 조합에 별칭이 있다. 갈림길은 하나다 — **크기를 컴파일 타임에 박는가(`Matrix3d`, `Vector3d`), 런타임에 정하는가(`MatrixXd`, `VectorXd`).** `X`가 "동적"의 표시이고, 뒤의 `d`/`f`가 `double`/`float`다.

이 선택은 문법 취향이 아니라 [2.1](#/memory-model)의 메모리 모델 선택이다. 고정 크기 행렬은 원소 배열이 객체 안에 통째로 들어 있다 — 지역 변수로 선언하면 **스택**이고, 힙 할당이 0회다. 동적 크기 행렬은 포인터와 크기만 들고 원소는 **힙**에 산다 — `vector<double>`([5.1](#/vector))과 같은 구조다. `sizeof`가 그 차이를 그대로 보여준다.

```console
sizeof(Matrix3d) = 72, sizeof(Vector3d) = 24, sizeof(MatrixXd) = 24
```

(실측.) `Matrix3d`는 double 9개 = 72바이트 그 자체다. `MatrixXd`는 행렬이 얼마나 크든 24바이트 — 힙 포인터 + 행 수 + 열 수다. 성능 차이를 3×3 행렬·벡터 곱 1억 회로 쟀다(`-O2`, 함수는 `noipa`로 격리 — [8.6](#/benchmarking)의 규율, 3회 실행 중앙값).

| 타입 | 1억 회 | 곱 1회당 | 배수 |
| --- | --- | --- | --- |
| `Matrix3d * Vector3d` | 766.1 ms | 7.7 ns | 1.0배 |
| `MatrixXd(3,3) * VectorXd` | 2378.8 ms | 23.8 ns | **약 3.1배 느림** |

같은 수학, 같은 데이터인데 3.1배다. 동적 크기 쪽은 결과를 쓸 때마다 크기 검사를 하고, 루프 횟수를 런타임에 알며, 무엇보다 임시가 생기는 순간마다 힙 할당이 낀다. 고정 크기 쪽은 크기가 타입에 있으므로 컴파일러가 루프를 완전히 펼치고(3×3이면 곱셈 9번·덧셈 6번을 그대로 나열), 스택 안에서 끝낸다.

로봇 코드의 선택 기준은 그래서 명확하다. **차원이 물리적으로 고정된 것 — 3D 회전(3×3), 동차 변환(4×4), 헥사포드 3자유도 다리의 자코비안(3×3) — 은 전부 고정 크기 타입으로 쓴다.** [6.8](#/realtime)에서 제어 루프 안의 힙 할당을 금지했는데, `Matrix3d`는 그 규칙을 타입 차원에서 지켜 준다 — [9.4](#/forward-kinematics)·[9.5](#/inverse-kinematics)의 다리 기구학을 1kHz 루프에서 다리 여섯 개분 돌려도 `malloc`이 0회다. `MatrixXd`는 차원이 런타임에 정해지는 것 — 포인트클라우드 전체, 관절이 n개인 범용 매니퓰레이터의 자코비안 — 에만 쓴다. [9.6](#/state-estimation)의 칼만 필터도 상태 차원이 고정된 공분산 연산의 연속이라 같은 원리가 반복된다.

::: perf 크기 4까지는 아예 다른 코드가 나온다
Eigen은 고정 크기가 충분히 작으면(내부 언롤링 한계 이하) 루프 자체를 소거한 직선 코드를 생성하고, 벡터화 가능한 크기(예: `Vector4d`, `Matrix4d`)는 SIMD 레지스터에 맞춰 정렬까지 강제한다(아래 정렬 절에서 실측). 위 표의 7.7ns에는 `noipa`로 막아 둔 함수 호출 비용이 포함돼 있다 — 실전처럼 인라인되면 곱셈 자체는 이보다 더 줄어든다. 방향만 기억하라: **작고 차원이 고정된 수학은 고정 크기 타입이 언제나 이긴다.**
:::

## 기본 문법 훑기: 초기화에서 블록까지

앞으로 매 절에서 쓸 문법을 실행 결과와 함께 한 번에 짚는다. 전부 아래 코드 한 벌이다.

```cpp title="basic.cpp — 9.2~9.5에서 계속 쓸 재료"
#include <Eigen/Dense>
#include <iostream>

int main() {
    Eigen::Matrix3d R;
    R << 1, 0,  0,          // comma-initializer: 행 우선으로 채운다
         0, 0, -1,          // (x축 기준 +90도 회전 -- 9.2에서 유도한다)
         0, 1,  0;

    Eigen::Vector3d p(0.10, 0.05, -0.02);        // 발끝 좌표 [m]

    Eigen::Vector3d q = R * p;                   // 회전 적용
    std::cout << "R * p = " << q.transpose() << "\n";
    std::cout << "R^T R = I? \n" << R.transpose() * R << "\n";
    std::cout << "p.norm() = " << p.norm() << "\n";

    // 4x4 동차 변환을 블록으로 조립한다 -- 9.3의 핵심 재료
    Eigen::Matrix4d T = Eigen::Matrix4d::Identity();
    T.block<3,3>(0,0) = R;                       // 좌상단 3x3 = 회전
    T.block<3,1>(0,3) = p;                       // 우상단 3x1 = 병진
    std::cout << "T =\n" << T << "\n";
    std::cout << "translation = " << T.col(3).head<3>().transpose() << "\n";
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 basic.cpp -o basic && ./basic
R * p =  0.1 0.02 0.05
R^T R = I?
1 0 0
0 1 0
0 0 1
p.norm() = 0.113578
T =
    1     0     0   0.1
    0     0    -1  0.05
    0     1     0 -0.02
    0     0     0     1
translation =   0.1  0.05 -0.02
```

(실측.) 읽는 법만 정리한다. `<<`로 시작하는 **comma-initializer**는 행 우선으로 채우고, 개수가 어긋나면 런타임 단언으로 죽는다 — 조용히 넘어가지 않는다. `.transpose()`·`.inverse()`·`.norm()`은 이름 그대로다(단 `.inverse()`는 이 절 뒷부분의 지연 평가 규칙을 따른다). `.block<3,3>(0,0)`은 (0,0)부터 3×3 부분행렬의 **뷰**다 — [5.8](#/views)의 `span`처럼 소유하지 않고 원본을 참조하므로, 읽기와 쓰기 양쪽에 쓸 수 있다(위에서는 대입 대상으로 썼다). `.col(3)`, `.head<3>()`도 같은 원리의 뷰다. 회전 3×3과 병진 3×1을 4×4에 꽂아 넣는 위 패턴은 [9.3](#/transforms)에서 동차 변환을 다룰 때 그대로 표준 문법이 된다.

## d = a + b + c는 아직 계산이 아니다

이제 이 절의 핵심으로 간다. [3.6](#/operator-overloading)에서 손으로 짠 `Vector3::operator+`는 호출 즉시 결과 벡터를 만들어 반환했다. 그 설계를 `VectorXd` 셋의 합에 그대로 적용하면 `a + b`가 임시 벡터 하나를 힙에 만들고, `(a+b) + c`가 또 하나를 만든다 — 원소 400만 개짜리 벡터라면 32MB 임시 두 개와 메모리 순회 세 번이다. Eigen은 다르게 동작한다고 주장한다: `+`는 아무것도 계산하지 않고, 대입 순간에 **루프 하나로 융합(fuse)**된다는 것이다. 주장의 전반부는 타입을 직접 찍어 보면 확인된다.

```cpp title="exprtype.cpp — a + b + c의 정체 (핵심부)"
auto expr = a + b + c;               // 계산이 일어났을까?
// typeid(expr)를 abi::__cxa_demangle로 풀어 출력한다
```

```console
$ ./exprtype
type of (a + b + c):
Eigen::CwiseBinaryOp<Eigen::internal::scalar_sum_op<double, double>,
  Eigen::CwiseBinaryOp<Eigen::internal::scalar_sum_op<double, double>,
    Eigen::Matrix<double, -1, 1, 0, -1, 1> const,
    Eigen::Matrix<double, -1, 1, 0, -1, 1> const> const,
  Eigen::Matrix<double, -1, 1, 0, -1, 1> const>
```

(실측. 읽기 좋게 줄만 바꿨다.) `a + b + c`의 타입은 `VectorXd`가 아니다. **"(a와 b의 합)과 c의 합"이라는 수식 자체가 타입으로 인코딩된 트리다** — `CwiseBinaryOp`(원소별 이항 연산) 안에 또 하나의 `CwiseBinaryOp`가 중첩돼 있고, 잎에는 원본 벡터들에 대한 참조가 들어 있다. 이것이 **표현식 템플릿(expression template)**이다: `operator+`가 값을 계산하는 대신 "무엇을 계산할지"를 기술하는 경량 객체를 반환하고, 그 객체가 `VectorXd`에 **대입되는 순간** 비로소 트리 전체를 한 번에 순회하는 루프가 인스턴스화된다. `d[i] = a[i] + b[i] + c[i]`를 i마다 한 번씩 — 임시 벡터 0개, 메모리 순회 1번. 계산을 결과가 필요한 시점까지 미루는 이 전략을 **지연 평가(lazy evaluation)**라 부른다.

::: hist 연산자 오버로딩의 한계를 연산자 오버로딩으로 푼 발명
"수식 표기를 유지하면 임시 객체가 생기고, 임시를 없애려면 표기를 포기해야 한다"는 1990년대 C++ 수치계산의 딜레마였다. 표현식 템플릿은 그 시기 Blitz++ 등 수치 라이브러리 진영에서 개척된 해법으로 — 연산자가 값 대신 **타입으로 인코딩된 수식**을 반환하게 만들어 딜레마를 부순다. 반환 타입이 수식마다 다르고 중첩 깊이만큼 자라나므로, 이 기법은 [4.3](#/template-mechanics)의 템플릿 인스턴스화 기계 없이는 성립하지 않는다 — Eigen이 헤더 온리일 수밖에 없는 또 하나의 이유다.
:::

## 실측: 임시 벡터 두 개의 진짜 가격

[8.6](#/benchmarking)의 표현대로 여기까지는 "벤치마크 없이는 진위를 가릴 수 없는 성능 주장"이다. 그래서 쟀다. 400만 원소 `VectorXd`(벡터당 32MB — L3 밖, RAM행) 넷으로 `d = a + b + c`를 네 가지 방식으로 20회씩 호출하고, 프로그램 5회 실행의 중앙값을 취했다(각 함수는 `noipa`로 격리, 결과는 관측 — 전부 [8.6](#/benchmarking)에서 배운 방어다).

```cpp title="fusion.cpp — 경쟁자 넷 (핵심부)"
// ① 순진한 구현: 연산마다 임시를 새로 만든다 (즉시 평가 라이브러리의 동작)
VectorXd t1(n), t2(n);                                  // 힙 할당 2회
for (i...) t1[i] = a[i] + b[i];                         // 순회 1
for (i...) t2[i] = t1[i] + c[i];                        // 순회 2
for (i...) d[i]  = t2[i];                               // 순회 3

// ② 임시를 미리 만들어 재사용 (할당 비용만 제거한 대조군)
// ③ Eigen:  d = a + b + c;
// ④ 손으로 융합한 루프: for (i...) d[i] = a[i] + b[i] + c[i];
```

| 구현 | 호출 1회당 | Eigen 대비 |
| --- | --- | --- |
| ① 임시 2개 + 순회 3번 (매번 할당) | 74.9 ms | **약 5.0배 느림** |
| ② 임시 재사용 + 순회 2번 | 17.3 ms | 약 1.15배 느림 |
| ③ Eigen `d = a + b + c` | **15.1 ms** | 1.0배 |
| ④ 손으로 융합한 루프 1개 | 15.8 ms | 약 1.05배 |

(g++ 13.3.0 / -O2 / Eigen 3.4.0 / Ubuntu 24.04 x86-64 실측. 절대값은 기기마다 다르지만 배수 구조는 재현된다.) 세 가지를 읽어낼 수 있다.

**첫째, 주장은 사실이다.** Eigen(③)은 손으로 최선을 다해 융합한 루프(④)와 사실상 같다 — 수식 표기를 유지한 대가가 0이다. 이 책이 여러 번 짚어 온 제로 오버헤드 추상화 원칙이 라이브러리 규모로 구현된 실례다.

**둘째, 임시의 비용은 대역폭보다 할당이다.** ①과 ②의 차이가 4.3배로 가장 크다 — 32MB짜리 임시 벡터를 호출마다 새로 만들면 힙 할당에 더해, [8.6](#/benchmarking)의 콜드 스타트 실측에서 본 그 페이지 폴트 비용을 **매 호출마다** 다시 낸다. ②와 ③의 차이(1.15배)가 순수한 "메모리 순회 횟수" 비용이다 — 이 크기에서는 연산이 아니라 대역폭이 병목이라([8.5](#/simd)의 RAM 실측과 같은 구조) 순회가 한 번 늘어난 만큼만 느려진다.

**셋째, 이 구조는 제어 루프의 생존 조건과 직결된다.** ①의 병리 — 수식 하나가 힙 할당을 유발하는 것 — 는 [6.8](#/realtime)이 금지한 바로 그것이다. 표현식 템플릿과 고정 크기 타입의 조합은 `y = J.transpose() * f + g` 같은 수식을 할당 0회로 계산하게 해 준다 — 헥사포드 제어 루프 안에서 Eigen 수식을 안심하고 쓸 수 있는 근거다.

::: interview "표현식 템플릿이 뭔가"에 답하는 법
Eigen을 이력서에 쓰면 나오는 질문이다. 답변 뼈대: ① `operator+`가 결과 대신 수식을 인코딩한 경량 타입(`CwiseBinaryOp`의 중첩)을 반환하고, 대입 순간 전체 수식이 루프 하나로 인스턴스화된다 — 임시 객체와 중간 순회가 사라진다(지연 평가). ② 실측으로 순진한 즉시 평가 대비 수 배, 손으로 융합한 루프와는 동률임을 확인했다(위 표의 수치를 그대로 말하면 된다). ③ 단 대가가 있다 — 수식의 타입이 `VectorXd`가 아니게 되므로 `auto`로 받으면 미평가 수식이 변수에 잡히는 함정이 생긴다(다음 절 주제). 비용 없는 추상화의 이면에 타입 복잡성이 있다는 것까지 말하면 설계 트레이드오프를 이해한 답이 된다.
:::

## auto와 Eigen을 섞지 마라

표현식 템플릿의 청구서는 성능이 아니라 **타입**으로 날아온다. [4.7](#/type-deduction)에서 "`auto`는 초기화식의 타입을 그대로 받는다"고 배웠다 — 그 규칙이 미평가 수식과 만나면, [2.3](#/references)이 예고했던 함정이 완성된다. Eigen 공식 문서가 명시적으로 경고하는 유명한 지점이고, 두 가지 방식으로 문다. 둘 다 재현했다.

**함정 1: 변수가 결과가 아니라 계산 계획이다.**

```cpp title="autotrap.cpp — 나중에 평가되는 x"
Eigen::Matrix2d A;
A << 1, 0,
     0, 1;                       // 단위행렬
Eigen::Vector2d b(3, 4);

auto x = A * b;                  // ❌ x는 결과가 아니라 "A와 b를 곱할 계획"
Eigen::Vector2d y = A * b;       // ✅ y는 지금 계산된 결과

A(0, 0) = 100;                   // A를 나중에 수정하면...

std::cout << "y = " << y.transpose() << "\n";
std::cout << "x = " << Eigen::Vector2d(x).transpose() << "\n";  // 여기서야 평가
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 autotrap.cpp -o autotrap && ./autotrap
y = 3 4
x = 300   4
```

(실측.) `x`를 만들 시점의 A는 단위행렬이었는데 결과는 `300 4`다 — `x`는 값이 아니라 A와 b를 **참조로** 붙잡은 수식이라, 읽는 순간의 A로 계산된다. 게다가 `x`를 두 번 읽으면 곱셈이 두 번 돈다 — 값이라고 믿은 변수가 사실은 호출할 때마다 다시 도는 함수였던 셈이다.

**함정 2: 수식이 참조하는 원본이 먼저 죽는다.** [4.7](#/type-deduction)에서 ASan으로 한 번 재현했던 그 패턴의 완결판이다 — 지역 벡터의 합 수식을 반환하면, 수식의 잎이 가리키는 벡터들은 함수가 끝날 때 파괴된다.

```cpp title="autodangle.cpp — 죽은 벡터를 참조하는 수식"
auto make_sum() {
    Eigen::VectorXd a = Eigen::VectorXd::Constant(1000, 1.0);
    Eigen::VectorXd b = Eigen::VectorXd::Constant(1000, 2.0);
    return a + b;                // ❌ CwiseBinaryOp가 곧 죽을 a, b를 참조
}
// main: Eigen::VectorXd v = make_sum();  <- 여기서야 평가, 이미 늦었다
```

```console
$ g++ -std=c++20 -Wall -Wextra -O1 -g -fsanitize=address -I/usr/include/eigen3 autodangle.cpp -o autodangle && ./autodangle
==9657==ERROR: AddressSanitizer: stack-use-after-return on address 0x7fba13c002c8
READ of size 8 at 0x7fba13c002c8 thread T0
    #0 ... Eigen::DenseStorage<double, -1, -1, 1, 0>::rows() const
    #2 ... Eigen::CwiseBinaryOp<...>::rows() const
    #6 ... in main autodangle.cpp:12
Address 0x7fba13c002c8 is located in stack of thread T0 ... in frame
    #0 ... in make_sum() autodangle.cpp:5
```

(실측, 발췌.) [2.11](#/ub-sanitizers)에서 배운 리포트 읽기 그대로다 — `main`이 `CwiseBinaryOp::rows()`를 통해 `make_sum`의 스택 프레임에 있던 벡터 객체를 읽었다. [5.8](#/views)의 댕글링 뷰와 완전히 같은 병리다: 소유하지 않는 참조가 소유자보다 오래 살았다.

::: warn 규칙은 한 줄이다 — Eigen 결과는 구체 타입으로 받아라
좌변에 `Vector3d`, `MatrixXd` 같은 실제 행렬 타입을 쓰는 순간 수식은 그 자리에서 평가되고 모든 함정이 사라진다 — 이 절의 모든 예제가 그렇게 쓰여 있다. 수식을 정말 변수에 담아 재사용하고 싶으면 `auto x = (A * b).eval();`로 명시적으로 평가시켜라. `auto`의 편리함은 [4.7](#/type-deduction)의 규칙대로 일반 타입에서만 성립한다 — **프록시를 반환하는 라이브러리(Eigen, `vector<bool>`) 앞에서 `auto`는 "정체를 숨기는" 키워드가 된다.**
:::

## 지연 평가의 이면: 앨리어싱

지연 평가에는 함정이 하나 더 있다. 수식이 대입 순간에 원소 단위로 계산된다는 것은, **읽는 대상과 쓰는 대상이 같으면 아직 안 읽은 원소를 덮어쓸 수 있다**는 뜻이다 — 행렬판 앨리어싱이다. 전치가 대표 사례다.

```cpp title="aliasing.cpp — 자기 자신에게 전치를 대입하면"
Eigen::Matrix3d A;
A << 1, 2, 3,
     4, 5, 6,
     7, 8, 9;
A = A.transpose();               // ❌ A를 읽으면서 A에 쓴다
```

기본 빌드에서 이 코드는 **런타임 단언으로 즉사한다**(실측, exit 134):

```console
$ ./aliasing
aliasing: Eigen/src/Core/Transpose.h:434: ... Assertion `... && "aliasing detected
during transposition, use transposeInPlace() or evaluate the rhs into a temporary
using .eval()"' failed.
Aborted
```

Eigen이 디버그 단언으로 앨리어싱을 감지해 준 것이다 — 고맙게도 수정 방법까지 메시지에 있다. 진짜 위험은 릴리즈 빌드다. `-DNDEBUG`를 켜면 단언이 사라지고, 같은 코드가 **조용히 틀린 행렬을 만든다**(실측):

```console
$ g++ ... -O2 -DNDEBUG ... && ./aliasing_ndebug
A = A.transpose():
1 2 3
2 5 6
3 6 9
```

전치가 아니라 상삼각이 하삼각을 덮은 잔해다 — (1,0)에 옛 (0,1)을 쓰는 순간 원래 (1,0)이 사라졌고, 나중에 (0,1)을 계산할 때는 이미 덮인 값을 읽었다. 해법은 단언 메시지 그대로 둘이다: `A.transposeInPlace()` 또는 `A = A.transpose().eval()`(임시로 한 번 평가한 뒤 대입).

여기서 Eigen 설계의 흥미로운 결정 하나가 설명된다. **행렬 곱은 이 규칙의 예외다.** `A = A * B`는 곱셈 특성상 거의 항상 앨리어싱이 생기므로, Eigen은 곱셈만은 지연 없이 임시에 먼저 평가하고 복사한다 — 안전이 기본값이다. 그래서 앨리어싱이 없다고 보장할 수 있을 때는 `C.noalias() = A * B;`로 임시 하나를 절약하는 옵트아웃이 제공된다. 다음 절의 GEMM 벤치마크 코드에 `noalias()`가 붙어 있는 이유다.

::: danger 단언은 -DNDEBUG와 함께 사라진다
위 실측이 보여준 순서를 기억하라 — 개발 빌드에서는 Eigen이 비명을 질러 주지만, `-DNDEBUG`가 켜진 릴리즈 빌드에서는 같은 버그가 **조용히 틀린 숫자**가 된다. 틀린 회전행렬은 크래시하지 않는다 — 로봇 다리가 엉뚱한 곳을 딛는 것으로 발현된다. Eigen을 쓰는 코드는 반드시 단언이 살아 있는 빌드로 먼저 충분히 돌려라. [7.6](#/googletest)의 테스트가 Debug 구성으로도 돌아야 하는 이유 하나가 추가된 것이다.
:::

## 8.5의 약속: 같은 소스, 세 개의 빌드

[8.5](#/simd)는 "Eigen::Matrix4f 곱셈을 쓰는 순간 이 절의 이득을 코드 한 줄 안 바꾸고 얻는다"고 약속했다. 확인한다. 512×512 `MatrixXd` 곱셈(GEMM) 20회를, **같은 소스를 세 가지로 빌드**해서 쟀다. Eigen은 자신이 어떤 SIMD 경로를 쓰는지 스스로 보고하는 함수(`Eigen::SimdInstructionSetsInUse()`)가 있어, 각 빌드의 첫 줄에 그 출력을 함께 실었다.

| 빌드 | SIMD in use (실측 출력) | 곱 1회당 | GFLOP/s | 배수 |
| --- | --- | --- | --- | --- |
| `-O2 -DEIGEN_DONT_VECTORIZE` | `None` | 63.0 ms | 4.3 | 1.0배 |
| `-O2` (기본) | `SSE, SSE2` | 31.3 ms | 8.6 | 2.0배 |
| `-O2 -march=native` | `AVX512, FMA, AVX2, AVX, SSE, ...` | **7.8 ms** | **34.5** | **8.1배** |

(g++ 13.3.0 / Eigen 3.4.0 / AVX-512 지원 Xeon 2.8GHz, 각 3회 실행 중앙값. 절대값은 기기마다 다르다.) 소스는 한 글자도 바뀌지 않았다 — `C.noalias() = A * B;` 그대로다. Eigen 헤더가 컴파일 플래그를 보고 내부 커널을 갈아 끼운 것이다: 벡터화를 끄면 스칼라 루프, 기본값이면 x86-64 기준선인 SSE2(128비트), `-march=native`면 이 CPU의 AVX-512(512비트)와 FMA까지 전부 쓴다. [8.5](#/simd)에서 배운 그대로 — CPU가 명령을 갖고 있어도 컴파일러에게 허가하지 않으면 잠들어 있고, 그 허가가 이 표에서는 **4배**(기본 대비)로 환산됐다.

[8.5](#/simd)의 RAM 실측에서는 벡터화 이득이 1.03배로 증발했는데 여기서는 8.1배가 온전히 나온 것도 그 절의 언어로 설명된다 — GEMM은 원소 하나를 여러 번 재사용하는 연산 밀도 높은 커널이라(Eigen 내부가 캐시 블로킹까지 한다), 병목이 대역폭이 아니라 연산이다. 벡터 유닛을 8배로 늘리면 실제로 8배 가까이 빨라지는, SIMD가 가장 빛나는 워크로드다.

::: perf 빌드 플래그가 수치 코드의 성능 스위치다
헥사포드의 수학은 512×512가 아니라 3×3, 4×4라 GEMM 절대 성능이 직접 중요한 일은 드물다 — 이 표의 교훈은 `-march` 플래그가 Eigen 커널 선택까지 바꾼다는 것이다. [8.5](#/simd)의 경고도 그대로 적용된다: `-march=native` 바이너리는 빌드 머신 전용이고, 로봇 보드 배포 빌드는 타깃 CPU를 명시한다. `EIGEN_DONT_VECTORIZE`는 성능 이슈가 Eigen 벡터화 경로 때문인지 30초 만에 판별하는 진단 스위치로 쓴다.
:::

## 정렬 문제의 어제와 오늘

[8.5](#/simd)에서 정렬 로드(`_mm256_load_pd`)가 32바이트 경계를 요구했던 것을 기억하라. Eigen의 고정 크기 벡터화 가능 타입은 [2.12](#/object-layout)의 `alignas` 그대로, 같은 요구를 타입에 새긴다 — 이 환경에서 `-march=native`로 빌드하면 `alignof(Eigen::Matrix4d)`가 **64**다(실측 — AVX-512 `zmm` 폭이다). 그런데 기본 `new`가 보장하는 정렬은 `__STDCPP_DEFAULT_NEW_ALIGNMENT__` = **16**뿐이다(실측). 64 > 16 — `Matrix4d`를 멤버로 가진 객체를 힙에 만들면 정렬이 깨질 수 있다는 뜻이고, 정렬 깨진 주소에 정렬 요구 SIMD 로드가 닿으면 크래시다.

C++14 시절까지 이 간극은 사용자의 숙제였다 — Eigen 고정 크기 멤버를 가진 모든 클래스에 `EIGEN_MAKE_ALIGNED_OPERATOR_NEW` 매크로를 손으로 붙여(`operator new`를 정렬 버전으로 오버로드해 주는 매크로다) 해결했고, 빠뜨리면 특정 환경에서만 터지는 악명 높은 크래시가 됐다. **C++17이 이 문제를 언어 차원에서 해소했다** — 정렬 인지 `new`(aligned new)다: `new` 표현식이 타입의 `alignof`를 보고 초과 정렬이면 `operator new(size_t, align_val_t)`를 자동으로 호출한다. 실측으로 확인했다:

```console
$ g++ -std=c++20 -O2 -march=native ... && ./align20     # Matrix4d 멤버를 가진 구조체
default new alignment : 16
alignof(LegState)     : 64
new LegState -> 0x55a661c802c0  (% 64 == 0)             # 64바이트 정렬 보장
```

같은 코드를 `-std=c++14`로 빌드하면 컴파일러가 정직하게 자백한다(실측): `warning: 'new' of type 'LegState' with extended alignment 64 [-Waligned-new=]` — "이 정렬을 보장 못 한다"는 경고다. 이 책은 C++20 기준이므로 결론은 간단하다. **`EIGEN_MAKE_ALIGNED_OPERATOR_NEW`는 역사다** — C++17 이상에서는 필요 없고, 오래된 코드베이스나 튜토리얼에서 이 매크로를 만나면 "aligned new 이전 시대의 흔적"으로 읽으면 된다.

::: deep 그 매크로가 아직 헤더에 남아 있는 이유
C++14 이하로 컴파일하는 사용자와의 호환성 때문이다. 같은 이유로 `std::vector<Eigen::Vector4d>`에 쓰라던 `Eigen::aligned_allocator`도 C++17 이상에서는 불필요하다 — [5.1](#/vector)의 `vector`가 쓰는 기본 할당자 역시 C++17부터 초과 정렬 타입을 올바르게 처리한다. ROS 2 생태계의 오래된 패키지에서 이 매크로들을 만나면, 지워야 할 버그가 아니라 안 써도 되는 보험으로 읽어라 — 남아 있어도 해는 없다.
:::

## 요약

- Eigen은 ROS 2 생태계(tf2, MoveIt2, PCL)의 사실상 표준 선형대수 라이브러리이고, 전체가 템플릿이라 **헤더 온리**다 — 링크할 `.so`가 0개임을 패키지 목록으로 확인했고, `-I/usr/include/eigen3` 하나로 컴파일이 끝난다([4.3](#/template-mechanics)의 컴파일 시간이 그 대가다).
- 크기가 물리적으로 고정된 수학(3×3 회전, 4×4 변환, 헥사포드 다리 자코비안)은 고정 크기 타입으로 쓴다 — 스택에 살고(sizeof(Matrix3d)=72 실측), 힙 할당이 0회라 [6.8](#/realtime)의 제어 루프 규칙을 타입이 지켜 주며, 3×3 곱 실측에서 동적 크기보다 3.1배 빨랐다.
- `a + b + c`의 타입은 `VectorXd`가 아니라 `CwiseBinaryOp`의 중첩 — 수식 트리다(typeid 실측). 대입 순간 루프 하나로 융합되는 **표현식 템플릿 + 지연 평가**이고, 실측에서 임시를 만드는 순진한 구현보다 5.0배, 손으로 융합한 루프와는 동률(1.05배 이내)이었다 — [8.6](#/benchmarking)이 예고한 검증 완료.
- **Eigen 결과를 `auto`로 받지 마라** — 변수에 값이 아니라 계산 계획이 잡힌다. 원본을 나중에 수정하면 결과가 바뀌는 것(단위행렬 곱이 `300 4`가 된 실측)과, 원본이 먼저 죽는 댕글링(ASan `stack-use-after-return` 실측)을 재현했다. 좌변에 구체 타입을 쓰거나 `.eval()`로 즉시 평가시킨다.
- 지연 평가의 이면은 앨리어싱이다 — `A = A.transpose()`는 디버그 빌드에서 단언으로 죽고(실측), `-DNDEBUG`에서는 조용히 틀린 행렬을 만든다(실측). `transposeInPlace()`/`.eval()`로 풀고, 곱셈만은 Eigen이 기본으로 임시를 만들어 안전하다 — `noalias()`가 그 옵트아웃이다.
- 같은 GEMM 소스가 빌드 플래그만으로 갈렸다: `EIGEN_DONT_VECTORIZE` 63.0ms → 기본(SSE2) 31.3ms → `-march=native`(AVX-512+FMA) 7.8ms, **8.1배**(실측) — [8.5](#/simd)의 "Eigen이 SIMD를 공짜로 준다"가 숫자로 확인됐다.
- 고정 크기 타입의 정렬 요구([2.12](#/object-layout)의 연장 — 이 환경 `alignof(Matrix4d)`=64)와 기본 `new`의 16바이트 보장 사이의 간극은 C++17의 정렬 인지 new가 메웠다 — `EIGEN_MAKE_ALIGNED_OPERATOR_NEW`는 C++17 이상에서 불필요한 과거의 유물이다.

::: quiz 연습문제
1~3번은 개념·판단 문제, 4번은 코드 작성형, 5번은 코드 리뷰형이다.

1. `auto expr = a + b + c;`(VectorXd 셋)에서 `expr`의 타입은 무엇이고, 실제 덧셈 루프는 언제 실행되는가? 이 설계가 없애는 비용 두 가지를 이 절의 실측 표에서 골라 답하라.

2. (판단) 헥사포드 제어 루프 안에서 다리 하나의 자코비안을 `Eigen::MatrixXd J(3,3);`으로 선언한 코드를 발견했다. `Matrix3d`로 바꿔야 하는 이유를 [6.8](#/realtime)의 규칙과 이 절의 실측 수치를 들어 두 가지로 설명하라.

3. (예측) 이 절의 융합 벤치마크에서 벡터 크기를 400만에서 1,000(8KB, L1 상주)으로 줄이고 반복 횟수를 늘려 다시 재면, ①(매번 할당)과 ③(Eigen)의 격차는 커질까 작아질까? "이 크기에서는 힙 할당·페이지 폴트 비용과 대역폭 비용의 비중이 어떻게 변하는가"를 축으로 예측하라.

4. (실습, 코드 작성형) `Eigen::Matrix4d make_transform(const Eigen::Matrix3d& R, const Eigen::Vector3d& p)`를 직접 작성하라 — 단위행렬에서 시작해 `.block<>()`으로 회전과 병진을 채워 반환한다. `main`에서 이 절의 R, p로 T를 만들고, `(T * T.inverse() - Eigen::Matrix4d::Identity()).norm()`이 1e-9보다 작은지 검사해 결과를 출력하라. `auto`는 한 번도 쓰지 않는 것이 규칙이다. 성공 기준: `g++ -std=c++20 -Wall -Wextra -fsanitize=address -I/usr/include/eigen3 transform.cpp && ./a.out`에서 검사가 통과하고 ASan이 조용할 것.

5. (코드 리뷰) 동료의 릴리즈 빌드 전용 코드에서 `pose = pose.transpose();`(Matrix4d)를 발견했다. 이 코드의 문제를 "왜 테스트에서 안 잡혔는가"까지 포함해 지적하고, 수정안 두 가지를 제시하라.
:::

::: answer 해설
1. 타입은 `CwiseBinaryOp<sum_op, CwiseBinaryOp<sum_op, VectorXd, VectorXd>, VectorXd>` — 덧셈 두 번이 중첩된 수식 트리이고(typeid 실측), 루프는 이 수식이 `VectorXd`에 **대입되는 순간** 한 번 실행된다. 없애는 비용: ① 중간 결과용 임시 벡터의 힙 할당(실측 표에서 ①→② 4.3배 — 매 호출 32MB 할당과 페이지 폴트), ② 중간 결과를 쓰고 다시 읽는 추가 메모리 순회(②→③ 1.15배). 합쳐서 순진한 구현 대비 5.0배였다.

2. ① `MatrixXd`는 원소를 힙에 두므로 생성·임시 발생 시마다 동적 할당이 낀다 — [6.8](#/realtime)의 "제어 루프에서 malloc 금지"를 매 주기 위반할 수 있다. `Matrix3d`는 72바이트가 통째로 스택이라 할당이 구조적으로 0회다. ② 성능 — 크기가 타입에 있으면 크기 검사가 사라지고 루프가 완전히 펼쳐진다. 이 절 실측에서 같은 3×3 곱이 3.1배 차이 났다(7.7ns 대 23.8ns). 1kHz × 다리 6개면 그 차이가 매초 6,000번 누적된다.

3. 격차가 **커진다**고 예측해야 한다. ③(Eigen)의 비용은 L1 상주 크기에서 순수 연산 수준으로 급감하지만, ①의 힙 할당·해제는 데이터가 작아져도 고정 비용으로 남는다 — 나노초대 연산에 마이크로초대 할당이 얹히므로 상대 배수는 커진다. 400만 원소에서는 반대로 대역폭 비용이 커서 할당 비용의 비중이 상대적으로 줄어든 것이다. 실제 배수는 재 봐야 안다 — 예측을 세우고 측정으로 확인하는 것이 [8.6](#/benchmarking)의 규율이다.

4. 함수 본문은 `Eigen::Matrix4d T = Eigen::Matrix4d::Identity(); T.block<3,3>(0,0) = R; T.block<3,1>(0,3) = p; return T;` 네 줄이면 된다. 반환 타입과 지역 변수 전부 구체 타입이므로 수식이 미평가로 새어 나갈 자리가 없다. `T * T.inverse()`는 회전+병진 변환이라 수치 오차 안에서 단위행렬이 나와야 하고, norm 검사가 1e-9 아래면 통과다. 이 함수가 [9.3](#/transforms)에서 다룰 동차 변환의 원형이다.

5. 문제: `A = A.transpose()`형 앨리어싱 — 지연 평가가 읽기 전의 원소를 덮어써 상삼각·하삼각이 뒤섞인 틀린 행렬을 만든다. 테스트에서 안 잡힌 이유: Eigen의 앨리어싱 단언은 `NDEBUG`가 켜지면 사라지는데(이 절 실측 — 디버그 빌드는 abort, 릴리즈 빌드는 조용히 오답), 이 코드는 릴리즈 전용이라 단언이 한 번도 실행되지 않았다. 디버그 구성으로도 도는 테스트가 있었다면 단언이 즉시 잡았을 것이다. 수정안: ① `pose.transposeInPlace();` ② `pose = pose.transpose().eval();` — 덧붙여, 4×4 동차 변환의 역이 목적이라면 전치가 아니라 [9.3](#/transforms)에서 다룰 역변환 공식을 써야 한다는 것까지 지적하면 완벽한 리뷰다.
:::

이 절의 실측은 전부 네 환경에서 재현해라. 순서대로: `g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 basic.cpp -o basic && ./basic`으로 기본기를 확인하고, `exprtype.cpp`로 `a + b + c`의 타입을 네 눈으로 본 뒤, `fusion.cpp`를 5회 돌려 네 기계의 배수를 표로 만들어라. `autodangle.cpp`는 반드시 `-fsanitize=address`로 빌드해 ASan 리포트의 스택을 [2.11](#/ub-sanitizers)에서 배운 대로 읽고, `aliasing.cpp`는 단언 있는 빌드와 `-DNDEBUG` 빌드를 둘 다 돌려 "비명"과 "침묵"의 차이를 확인하라. 마지막으로 `matmul.cpp`를 `-DEIGEN_DONT_VECTORIZE` / 기본 / `-march=native` 세 벌로 빌드해 `SimdInstructionSetsInUse()` 출력과 시간을 함께 기록하라 — 절대값은 다르겠지만 "플래그가 커널을 갈아 끼운다"는 구조는 어디서나 같다.

**다음 절**: [9.2 회전 표현: 행렬, 오일러, 쿼터니언](#/rotations) — 오늘 comma-initializer로 손으로 채운 그 회전행렬을 이제 수학으로 만든다. 왜 회전 표현이 세 가지나 있고, 짐벌락이 무엇이며, 언제 `Matrix3d`가 아니라 `Quaterniond`를 쓰는지 다룬다.
