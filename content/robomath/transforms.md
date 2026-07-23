# 9.3 동차 변환과 좌표 프레임

::: lead
[9.2](#/rotations)는 자세만 다뤘다. 그런데 "라이다가 본 장애물이 몸통 기준으로 어디인가"를 계산하는 순간 회전만으로는 안 된다 — 라이다는 몸통 원점에 붙어 있지 않기 때문이다. 회전 행렬과 이동 벡터를 따로 들고 다니면 프레임 두 개만 건너도 합성 코드가 뒤엉키기 시작한다. 이 절은 좌표 끝에 1을 하나 붙이는 트릭(동차 좌표)으로 회전+이동을 4×4 행렬 하나로 합치고, 그 행렬의 집합 SE(3)의 합성·역변환·체인 계산을 전부 Eigen 실측으로 확인한다. tf2의 TF 트리, URDF의 joint origin, 다음 절의 순기구학이 전부 이 4×4 곱 하나 위에 서 있다.
:::

## 회전만으로는 라이다 점을 못 옮긴다

상황을 하나 고정하자. 이 절 끝까지 이 수치를 쓴다.

- 헥사포드 몸통(`base_link`)이 world에서 위치 $(0.040, 0.030, 0.060)$ m, yaw 90°로 서 있다.
- 라이다는 몸통 기준 앞으로 50 mm, 위로 35 mm 지점에 회전 없이 달려 있다.
- 라이다가 자기 x축 방향 2.0 m에서 장애물을 봤다: $p_{lidar} = (2, 0, 0)$.

이 장애물은 world 좌표로 어디인가? [9.2](#/rotations)의 도구는 $p' = Rp$ 하나였다. 그런데 지금은 프레임마다 **원점이 다르다**. 프레임 하나를 건너는 완전한 규칙은 회전 더하기 이동이다:

$$p_parent = R p_child + t$$

곱하고, 더한다. 두 프레임을 건너려면 이걸 두 번 겹친다.

```cpp title="따로 들고 다니기 (조각)"
Vector3d p_base  = R_bl * p_lidar + t_bl;   // lidar -> base
Vector3d p_world = R_wb * p_base  + t_wb;   // base  -> world
```

```console
$ ./a.out
p_base  =  2.05     0 0.035
p_world =  0.04  2.08 0.095
```

두 단계까지는 참을 만하다. 문제는 "base를 거치지 않는 lidar → world 직행 변환"을 만들 때 시작된다. 위 식에 식을 대입하면:

$$p_world = R_wb (R_bl p + t_bl) + t_wb = (R_wb R_bl) p + (R_wb t_bl + t_wb)$$

즉 합성 규칙이 **두 개**다: 회전은 $R' = R_2 R_1$, 이동은 $t' = R_2 t_1 + t_2$ — 그냥 더하는 게 아니라 **돌려서** 더해야 한다. 헥사포드 다리는 world → base → coxa → femur → tibia, 프레임 다섯 개 체인이다. 이 두 공식을 네 번 중첩하면서 어느 이동을 어느 회전으로 돌려야 하는지 손으로 추적하는 코드는 반드시 틀린다. 필요한 것은 "회전+이동"을 **한 덩어리**로 만들어, 합성이 연산 하나로 끝나게 하는 것이다.

## 트릭: 좌표 끝에 1을 붙인다

3차원 점 $(x, y, z)$를 4차원 $(x, y, z, 1)$로 쓴다. 이것이 **동차 좌표**(homogeneous coordinates)다. 그리고 회전과 이동을 4×4 행렬 하나에 블록으로 담는다:

```text nolines
[ R  t ] [ p ]   [ Rp + t ]
[ 0  1 ] [ 1 ] = [    1   ]
```

윗줄이 정확히 "곱하고 더하기"를 수행하고, 아랫줄 $(0\ 0\ 0\ 1)$은 마지막 성분의 1을 1로 유지한다. 이동이 행렬 곱 **안으로** 들어갔다 — 3차원에서는 선형이 아니던 연산(이동은 원점을 보존하지 않는다)이 한 차원 위에서 선형이 됐다. 이 4×4 행렬을 **동차 변환**(homogeneous transform)이라 부른다. 대가는 숫자 몇 개, 보상은 합성이 그냥 행렬 곱이 되는 것이다:

```text nolines
[ R2  t2 ] [ R1  t1 ]   [ R2*R1   R2*t1 + t2 ]
[  0   1 ] [  0   1 ] = [   0          1     ]
```

블록 곱을 전개하면 아까 손으로 유도한 두 공식이 **자동으로** 나온다. 더 이상 사람이 "돌려서 더하기"를 기억할 필요가 없다 — 행렬 곱이 대신 기억한다. Eigen으로 양쪽을 다 만들어 일치를 확인하자.

```cpp title="homogeneous.cpp"
#include <Eigen/Dense>
#include <Eigen/Geometry>
#include <iostream>
#include <numbers>

int main() {
    using namespace Eigen;
    constexpr double pi = std::numbers::pi;

    Matrix3d R_wb = AngleAxisd(pi / 2, Vector3d::UnitZ()).toRotationMatrix();
    Vector3d t_wb(0.040, 0.030, 0.060);
    Matrix3d R_bl = Matrix3d::Identity();
    Vector3d t_bl(0.050, 0, 0.035);
    Vector3d p_lidar(2.0, 0.0, 0.0);

    // 방법 1: R, t 따로 — 손 공식 (R2*R1, R2*t1 + t2)
    Matrix3d R_wl = R_wb * R_bl;
    Vector3d t_wl = R_wb * t_bl + t_wb;
    std::cout << "R_wl*p+t_wl = " << (R_wl * p_lidar + t_wl).transpose() << "\n";

    // 방법 2: 4x4 동차 변환 — 블록에 채우고 곱 하나
    Matrix4d T_wb = Matrix4d::Identity(), T_bl = Matrix4d::Identity();
    T_wb.block<3,3>(0,0) = R_wb;  T_wb.block<3,1>(0,3) = t_wb;
    T_bl.block<3,3>(0,0) = R_bl;  T_bl.block<3,1>(0,3) = t_bl;
    Matrix4d T_wl = T_wb * T_bl;
    std::cout << "T_wl =\n" << T_wl << "\n";
    std::cout << "T_wl*[p;1] = " << (T_wl * Vector4d(2, 0, 0, 1)).transpose() << "\n";

    Matrix4d T_manual = Matrix4d::Identity();
    T_manual.block<3,3>(0,0) = R_wl;  T_manual.block<3,1>(0,3) = t_wl;
    std::cout << "diff = " << (T_wl - T_manual).norm() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 homogeneous.cpp && ./a.out
R_wl*p+t_wl =  0.04  2.08 0.095
T_wl =
6.12323e-17          -1           0        0.04
          1 6.12323e-17           0        0.08
          0           0           1       0.095
          0           0           0           1
T_wl*[p;1] =  0.04  2.08 0.095     1
diff = 0
```

`diff = 0` — 두 방법은 같은 물건이고, 이제부터는 4×4 하나만 들고 다니면 된다. 수치도 읽어 두자. `T_wl`의 마지막 열 $(0.04, 0.08, 0.095)$은 $R_{wb} t_{bl} + t_{wb}$다: yaw 90°가 "앞으로 50 mm"를 "왼쪽으로 50 mm"로 돌려 놓아서 $0.030 + 0.050 = 0.08$이 y에 갔다. 그리고 장애물은 world에서 $(0.04, 2.08, 0.095)$ — 몸통이 +y를 보고 서 있으니 2 m짜리 측정값이 y축으로 뻗은 것이다.

::: hist 동차 좌표는 원근에서 왔다
동차 좌표는 로봇공학의 발명품이 아니다. 뫼비우스가 1827년 사영기하학에서 도입한 표기로, 일반형은 $(x, y, z, w)$가 3차원 점 $(x/w, y/w, z/w)$를 나타낸다. $w$로 나누는 이 규칙이 원근 투영(멀수록 작게)을 행렬 곱으로 만들어 주기 때문에 GPU 그래픽스 파이프라인 전체가 이 위에 서 있고, 카메라 투영 행렬(Part XI의 OpenCV에서 만난다)도 같은 틀이다. 로봇의 강체 변환은 마지막 행을 $(0\ 0\ 0\ 1)$로 고정해 $w$가 항상 1로 유지되는 특수한 경우 — 원근 왜곡이 없는 부분집합이다.
:::

## 점은 w=1, 방향은 w=0이다

네 번째 성분에는 조작 이상의 의미가 있다. 이동은 **위치**에는 적용돼야 하지만 **방향**에는 적용되면 안 된다 — "위쪽"이라는 방향은 로봇이 어디에 서 있든 위쪽이다. 동차 좌표는 이 구분을 마지막 성분으로 인코딩한다: 점은 $(x, y, z, 1)$, 방향 벡터는 $(x, y, z, 0)$. 블록 곱을 다시 보면 $w = 0$일 때 $t \cdot 0$이 되어 이동이 **저절로** 사라진다.

```cpp title="점 vs 방향 (조각)"
Isometry3d T = Translation3d(0.040, 0.030, 0.060)
             * AngleAxisd(pi / 2, Vector3d::UnitZ());
Matrix4d T4 = T.matrix();
std::cout << "T*[2 0 0 1] = " << (T4 * Vector4d(2, 0, 0, 1)).transpose() << "\n";
std::cout << "T*[2 0 0 0] = " << (T4 * Vector4d(2, 0, 0, 0)).transpose() << "\n";
```

```console
$ ./a.out
T*[2 0 0 1] = 0.04 2.03 0.06    1
T*[2 0 0 0] = 1.22465e-16           2           0           0
```

같은 $(2, 0, 0)$인데 점은 이동까지 받아 $(0.04, 2.03, 0.06)$으로 갔고, 방향은 회전만 받아 $(0, 2, 0)$이 됐다. 하나 더 — 두 점의 차 $p - q$는 $w = 1 - 1 = 0$이다. **점에서 점을 빼면 자동으로 방향 벡터가 된다.** 동차 좌표의 대수가 기하적 상식(위치의 차는 변위다)과 정확히 일치하는 지점이다.

::: danger 법선 벡터를 점처럼 변환하는 함정
바닥 평면의 법선 $(0, 0, 1)$을 위의 T로 "점처럼" 통째로 변환하면 이 환경 실측으로 $(0.04, 0.03, 1.06)$, norm 1.061 — 더 이상 단위벡터도 아니고 방향도 틀렸다. 자세를 기울인 실측에서는 더 심각하다: 평면 위 방향벡터와 법선의 내적은 변환 후에도 0이어야 하는데, 점처럼 변환한 법선은 **0.7264**가 나왔다(올바르게 회전만 적용하면 정확히 0). 발끝 접지 판정이나 지형 경사 추정이 이 내적을 쓰면 로봇이 평지를 경사면으로 착각한다. Eigen 함정이 겹친다: `Isometry3d * Vector3d`는 **점 취급**이다(이동 포함). 방향·법선은 `T.linear() * v`로 회전만 적용하라. (스케일·전단이 섞인 일반 아핀 변환에서 법선은 선형부의 역전치가 필요하지만, 회전뿐인 강체 변환은 $R^{-T} = R$이라 R을 그대로 쓰면 된다.)
:::

## SE(3) — 역변환이 닫힌 형태다

$R \in$ SO(3)인 $[R\ t;\ 0\ 1]$ 형태의 4×4 행렬 전체를 **SE(3)**(Special Euclidean group, 특수유클리드군)라 부른다 — 유효한 강체 변환(회전+이동)의 집합이고, [9.2](#/rotations)의 SO(3)에 이동이 붙은 것이다. 합성해도 SE(3)이고, 항등(단위행렬)이 있고, 역이 있다. 그 역이 얼마나 싼지가 이 절의 두 번째 보상이다.

$p' = Rp + t$를 $p$에 대해 풀면 $p = R^T p' - R^T t$. 즉:

$$T^{-1} = [R^T, -R^T t; 0 1]$$

일반 4×4 역행렬(가우스 소거·LU 분해)이 아니라 **전치 한 번 + 행렬-벡터 곱 한 번**이다. SO(3)에서 $R^{-1} = R^T$가 공짜였던 것이 SE(3)까지 이어진다. 손으로 만든 닫힌 형태와 Eigen의 `inverse()`가 일치하는지 확인하자.

```cpp title="se3_inverse.cpp (조각)"
Isometry3d T = Translation3d(0.040, 0.030, 0.060)
             * AngleAxisd(pi / 2, Vector3d::UnitZ());
Matrix3d R = T.linear();
Vector3d t = T.translation();

Matrix4d Ti_hand = Matrix4d::Identity();
Ti_hand.block<3,3>(0,0) = R.transpose();
Ti_hand.block<3,1>(0,3) = -R.transpose() * t;

std::cout << "||Ti_hand - T.inverse()|| = "
          << (Ti_hand - T.inverse().matrix()).norm() << "\n";
std::cout << "sizeof(Isometry3d) = " << sizeof(Isometry3d)
          << ", sizeof(Matrix4d) = " << sizeof(Matrix4d) << "\n";
```

```console
$ ./a.out
||Ti_hand - T.inverse()|| = 0
sizeof(Isometry3d) = 128, sizeof(Matrix4d) = 128
```

차이가 정확히 0 — `Isometry3d::inverse()`가 내부에서 정확히 이 닫힌 형태를 쓴다는 뜻이다. "카메라 → 몸통을 뒤집어 몸통 → 카메라"는 로봇 코드에서 매일 일어나는 일이고, TF 트리에서 위로 올라가는 모든 걸음이 이 역변환이다.

::: perf 역변환 비용·정확도 실측 (g++ 13 / -O2 / Eigen 3.4.0 / x86-64)
2천만 회 평균: `Isometry3d::inverse()` **18 ns/회**, `Matrix4d::inverse()`(일반 역행렬) **25~30 ns/회** — 약 1.4~1.7배 차이다(절대값은 기기마다 다르다). double 정확도는 이 스케일에서 사실상 동급이다 — 무작위 강체 변환 10만 개 최악값으로 직교성 이탈이 닫힌 형태 $2.0 \times 10^{-15}$, 일반 역행렬 $2.3 \times 10^{-15}$. 차이가 벌어지는 곳은 **float**다: $|t| < 100$ m 스케일에서 역변환 이동 성분의 최악 오차가 닫힌 형태 **29 µm**, 일반 역행렬 **115 µm**로 4배 — 구조를 아는 쪽이 큰 이동값에서 자릿수를 덜 잃는다. 그리고 수치 이전에 구조적 보장이 있다: 닫힌 형태의 회전 블록은 원본의 전치 **그 자체**라 SO(3) 이탈이 새로 생기지 않고, 마지막 행은 계산 없이 $(0\ 0\ 0\ 1)$이다. 임베디드 보드에서 float로 TF 체인을 계산하는 순간([9.2](#/rotations)의 드리프트 실측과 같은 이유로) 이 차이는 현실이 된다.
:::

::: interview "동차 변환은 왜 4×4 행렬인가"
로보틱스·그래픽스 면접의 단골이다. 모범 답변 뼈대: ① 이동은 원점을 보존하지 않아 3×3 행렬(선형 변환)에 담을 수 없다 — 차원을 하나 올려 점을 $(x,y,z,1)$로 들면 아핀 변환이 선형이 된다. ② 그러면 회전+이동의 합성이 행렬 곱 하나로 통일되고, 결합법칙 덕에 프레임 체인·트리 계산이 순수한 곱셈 대수가 된다. ③ 역변환이 $[R^T, -R^T t]$ 닫힌 형태로 나온다. ④ 마지막 행을 풀어주면 같은 4×4 틀이 원근 투영까지 담는다 — 그래픽스·비전과 파이프라인을 공유하는 이유. ⑤ 마지막 행이 $(0\ 0\ 0\ 1)$로 고정된 부분집합이 SE(3), 곧 강체 변환이다. 여기까지 말하면 충분하다.
:::

## Eigen::Isometry3d — 로봇 코드의 표준 타입

`Matrix4d`에 블록을 손으로 채우는 건 원리 확인용이고, 실전 타입은 따로 있다. Eigen의 `Transform` 계열 중 강체 변환 전용이 `Isometry3d`다. 만드는 관용구부터:

```cpp title="isometry_idiom.cpp (조각)"
// "회전하고 나서 이동" — 점에는 오른쪽부터 적용된다
Isometry3d T = Translation3d(0.040, 0.030, 0.060)
             * AngleAxisd(pi / 2, Vector3d::UnitZ());

Matrix3d R = T.linear();        // 회전 블록 (3x3)
Vector3d t = T.translation();   // 이동 블록 (3x1)
Matrix4d M = T.matrix();        // 4x4 전체가 필요할 때
Vector3d p = T * Vector3d(2, 0, 0);   // 점 변환 — 곱 하나
```

`Translation3d * AngleAxisd` 순서가 $[R\ t]$ 배치 그대로다: 점 입장에서 회전이 먼저, 이동이 나중. 순서를 뒤집으면 다른 변환이 된다 — 실측으로:

```cpp title="곱 순서 비교 (조각)"
Isometry3d T1 = Translation3d(1, 0, 0) * AngleAxisd(pi / 2, Vector3d::UnitZ());
Isometry3d T2 = AngleAxisd(pi / 2, Vector3d::UnitZ()) * Translation3d(1, 0, 0);
Vector3d p(1, 0, 0);
```

```console
$ ./a.out
T1 * p = 1 1 0
T2 * p = 1.22465e-16           2           0
T1.translation() = 1 0 0
T2.translation() = 6.12323e-17           1           0
```

::: warn 곱 순서를 뒤집으면 이동까지 돌아간다
`T2 = 회전 * 이동`은 "이동하고 나서 회전" — 이동 벡터 자체가 회전에 말려들어 `T2.translation()`이 $(0, 1, 0)$이 됐다. [9.2](#/rotations)의 회전 비가환이 이동까지 확장된 것이다. 관용구는 하나로 고정하라: **`Translation3d(...) * AngleAxisd(...)`, "이 프레임의 원점 위치, 그리고 자세"** — URDF `<origin xyz="..." rpy="..."/>`가 정확히 이 의미라서, 이 순서로 쓰면 URDF를 그대로 코드로 옮길 수 있다.
:::

`Matrix4d`와 뭐가 다른가? 저장은 같다 — 위 실측처럼 `sizeof`가 둘 다 128, 내부는 똑같은 4×4다. 다른 것은 **타입이 아는 것**이다. `Isometry3d`는 "선형 블록이 회전이다"를 컴파일 타임 모드(`Eigen::Isometry`)로 알고 있어서 `inverse()`가 자동으로 닫힌 형태를 타고, `rotation()`이 `linear()`의 별칭이 되어 공짜다. `Matrix4d`는 그냥 숫자 16개라 `inverse()`가 일반 역행렬 알고리즘으로 간다. 위 perf 상자의 1.4~1.7배와 float 정확도 4배가 이 타입 정보 하나에서 나온다.

::: deep Transform의 모드 — 보장이 아니라 약속이다
`Transform<double, 3, Mode>`의 Mode에는 `Isometry` 말고 `Affine`(스케일·전단 허용), `Projective`(마지막 행도 자유)가 있다. Eigen 3.4.0 소스(`Transform.h`)를 열면 `rotation()`이 Isometry 모드에서는 `linear()`를 그대로 반환하고, Affine 모드에서는 SVD 기반 분해(`computeRotationScaling`)로 회전을 **추출**한다 — 같은 함수 이름이 모드에 따라 공짜와 행렬 분해로 갈린다. 주의: Isometry 모드는 **검증하지 않는다**. `T.linear() = 2 * Matrix3d::Identity()`처럼 스케일을 밀어 넣어도 컴파일도 실행도 조용하고, `inverse()`가 전치를 역행렬로 착각해 조용히 틀린 답을 낸다. 모드는 컴파일러가 지켜주는 불변식이 아니라 당신이 지켜야 하는 약속이다.
:::

::: danger Isometry3d의 기본 생성자는 초기화하지 않는다
`Isometry3d T;`는 단위 변환이 아니라 **쓰레기값**이다 — Eigen이 Matrix 계열 전체에 적용하는 "기본 생성자는 비싼 초기화를 안 한다" 정책([9.1](#/eigen))이 Transform에도 그대로다. 시작은 반드시 `Isometry3d T = Isometry3d::Identity();`로 하라. 멤버 변수로 둔 변환을 초기화 없이 곱에 넣는 버그는 "가끔 이상한 자세"로 나타나서 재현이 지독하게 어렵다.
:::

::: note tf2_eigen — 메시지와 Isometry3d 사이의 다리
ROS 2에서 변환은 노드 경계를 `geometry_msgs`(Transform, Pose — 이동 벡터 + [9.2](#/rotations)의 쿼터니언)로 건너고, 수학은 Eigen으로 한다. 그 사이의 공식 다리가 `tf2_eigen` 패키지다: `tf2::fromMsg()`/`tf2::toMsg()`가 `geometry_msgs` ↔ `Isometry3d`를 양방향 변환해 준다. 성분을 손으로 옮기다 (x, y, z, w) 순서 사고([9.2](#/rotations)의 danger 상자)를 내지 말고 이 다리를 쓰라. [10.7 tf2](#/tf2)에서 실제 코드로 다룬다.
:::

::: interview "Isometry3d와 Matrix4d의 차이는?"
Eigen을 이력서에 쓰면 나오는 질문이다. 뼈대: ① 저장은 동일한 4×4(sizeof 128 실측) — 차이는 데이터가 아니라 타입 정보다. ② `Isometry3d`는 선형 블록이 회전임을 컴파일 타임에 알아 `inverse()`가 닫힌 형태 $[R^T, -R^T t]$로 계산된다(이 환경 실측 1.4~1.7배 빠르고 float에서 4배 정밀). ③ `rotation()`이 공짜다(Affine 모드면 SVD). ④ 함수 시그니처에 `Isometry3d`를 받으면 "강체 변환만 들어온다"는 계약이 코드에 박힌다 — `Matrix4d`는 아무 행렬이나 받는다는 뜻이 된다. ⑤ 단, 모드는 검증되지 않는 약속이라 불변식 유지는 프로그래머 책임이다. ②와 ④를 말하면 합격점이다.
:::

## 표기 규율 — T_parent_child로 고정한다

수학보다 먼저 사고가 나는 곳이 표기다. "base에서 lidar로 가는 변환"이라는 말은 중의적이다 — 점을 lidar 좌표에서 base 좌표로 **옮기는** 행렬인가, base 프레임을 lidar 프레임 위치로 **움직이는** 행렬인가? 두 해석은 서로 역행렬이고, 문헌마다 어느 쪽을 T_base_lidar라 부르는지 다르다. 그래서 이 책은 표기를 하나로 못박고 끝까지 고정한다.

**이 책 전체에서 $T_{A\_B}$는 $p_A = T_{A\_B} \cdot p_B$다** — B 좌표로 적힌 점을 A 좌표로 옮기는 행렬. 같은 행렬의 두 번째 독법도 함께 외워라: $T_{A\_B}$의 이동 성분은 **A에서 본 B 원점의 위치**, 회전 성분은 A에서 본 B의 자세다. 위 실측에서 `T_wl.translation()`이 $(0.04, 0.08, 0.095)$였는데, 이게 정확히 world에서 본 라이다의 위치다. "B를 A 좌표로 데려오는 행렬"과 "A가 바라본 B의 자세" — 같은 물건이다.

이 표기의 진짜 힘은 **합성 검산이 기계적**이라는 것이다:

```text nolines
T_w_l  =  T_w_b * T_b_l
              |    |
              +----+--- inner indices must match (b == b)
```

인접한 안쪽 인덱스가 도미노처럼 맞물려야 한다. $T_{w\_b} \cdot T_{b\_l}$은 b가 맞물려 $T_{w\_l}$이 되고, $T_{w\_b} \cdot T_{l\_b}$는 b와 l이 어긋나므로 **쓰기 전에 틀렸다는 걸 안다**. 뒤집힌 방향이 필요하면 역변환으로 인덱스를 스왑한다: $T_{b\_w} = T_{w\_b}^{-1}$. 이 검산 하나가 아래 "자주 나는 사고" 절의 버그를 타이핑 단계에서 잡는다.

생태계도 이 관례와 일치한다. URDF joint의 `<origin>`은 부모 링크 좌표로 적은 자식 프레임의 자세 — 정확히 $T_{parent\_child}$다. tf2의 `lookupTransform("world", "lidar", ...)`은 두 번째 인자(source) 좌표의 점을 첫 번째 인자(target) 좌표로 옮기는 변환, 즉 $T_{world\_lidar}$를 돌려준다. 변수명도 같은 규율로 지어라: `T_world_base`, `T_base_lidar` — 코드 리뷰에서 곱의 인덱스가 맞물리는지 눈으로 검산할 수 있는 이름이 방어선이다.

## 완결 예제 — 장애물은 world 어디에 있나

이 절의 도입 문제를 처음부터 끝까지 `Isometry3d`로 푼다. 그대로 타이핑하라.

```cpp title="lidar_chain.cpp" {17}
#include <Eigen/Dense>
#include <Eigen/Geometry>
#include <iostream>
#include <numbers>

int main() {
    using namespace Eigen;
    constexpr double pi = std::numbers::pi;

    // 몸통: world 에서 (0.040, 0.030, 0.060) m, yaw 90도
    Isometry3d T_world_base = Translation3d(0.040, 0.030, 0.060)
                            * AngleAxisd(pi / 2, Vector3d::UnitZ());
    // 라이다: 몸통에서 앞 50mm, 위 35mm, 회전 없음 (URDF joint origin에 해당)
    Isometry3d T_base_lidar = Translation3d(0.050, 0.0, 0.035)
                            * AngleAxisd(0.0, Vector3d::UnitZ());

    Isometry3d T_world_lidar = T_world_base * T_base_lidar;  // 인덱스 도미노: b == b

    Vector3d p_lidar(2.0, 0.0, 0.0);            // 라이다가 본 장애물
    std::cout << "p_world = " << (T_world_lidar * p_lidar).transpose() << "\n";
    std::cout << "lidar origin in world = "
              << T_world_lidar.translation().transpose() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 lidar_chain.cpp && ./a.out
p_world =  0.04  2.08 0.095
lidar origin in world =  0.04  0.08 0.095
```

손 검산과 맞춰 보자. 라이다 점 $(2, 0, 0)$은 base에서 $(2.05, 0, 0.035)$(마운트 오프셋만 더해짐), yaw 90°가 그걸 y축으로 돌리고 몸통 위치를 더하면 $(0.04, 0.030 + 2.05, 0.060 + 0.035) = (0.04, 2.08, 0.095)$. 4×4 행렬을 의식할 일은 한 번도 없었다 — 프레임을 `Isometry3d`로 정의하고, 인덱스가 맞물리게 곱하고, 점에 적용했을 뿐이다. 이 세 동작이 로봇 기하 계산의 전부다.

## 트리로 확장하면 그게 TF다

실제 로봇의 프레임은 일렬이 아니라 **트리**다. 몸통 아래에 라이다가 붙고, 같은 몸통 아래에 다리가 붙고, 다리는 coxa → femur → tibia로 이어진다. 트리의 모든 변환은 부모 기준 $T_{parent\_child}$ 하나씩이고, 임의 프레임의 world 자세는 뿌리부터 그 프레임까지 경로를 따라 곱한 것이다: $T_{w\_femur} = T_{w\_base} \cdot T_{base\_coxa} \cdot T_{coxa\_femur}$. 아래 위젯이 정확히 이 트리다 — 몸통은 위 예제처럼 yaw 90°로 서 있고, 다리 한 개가 3단 체인으로 붙어 있다.

::: widget frame-transform-3d
{ "frames": [
    { "name": "base_link", "parent": "world", "xyz": [40, 30, 60], "rpy": [0, 0, 1.5707963] },
    { "name": "lidar", "parent": "base_link", "xyz": [50, 0, 35], "rpy": [0, 0, 0] },
    { "name": "leg_coxa", "parent": "base_link", "xyz": [45, 40, -10], "rpy": [0, 0, 0.5236] },
    { "name": "leg_femur", "parent": "leg_coxa", "xyz": [28, 0, 0], "rpy": [0, 0, 0] },
    { "name": "leg_tibia", "parent": "leg_femur", "xyz": [50, 0, 0], "rpy": [0, 0, 0] }
  ],
  "interactive": "leg_coxa" }
:::

수치가 본문과 맞물려 있다(단위만 mm로 읽어라 — 몸통이 (40, 30, 60), 라이다가 (50, 0, 35)). 확인할 것 세 가지.

1. **캡션의 world 기준 변환을 검산하라.** coxa는 base에서 $(45, 40, -10)$, yaw 30°다. 회전은 $R_z(90°) \cdot R_z(30°) = R_z(120°)$ — 캡션의 $[-0.50\ -0.87\ 0\ |\ 0.87\ -0.50\ 0\ |\ 0\ 0\ 1]$이 그 행렬이다. 이동은 $R_z(90°) \cdot (45, 40, -10) + (40, 30, 60) = (-40 + 40,\ 45 + 30,\ 50) = (0, 75, 50)$ — 캡션의 $(0.00, 75.00, 50.00)$과 일치한다. 이 환경에서 같은 곱을 Eigen으로 돌린 결과도 소수점까지 같다.
2. **yaw 슬라이더를 돌려 보라.** coxa 하나를 돌렸는데 femur와 tibia — 자식과 **손자** — 가 통째로 따라 돈다. $T_{w\_tibia} = T_{w\_b} \cdot T_{b\_coxa} \cdot T_{coxa\_femur} \cdot T_{femur\_tibia}$에서 가운데 인자 하나가 바뀌면 그 뒤 곱 전체가 바뀌기 때문이다. 다음 절의 순기구학에서 이 "관절 하나가 하류 전체를 움직인다"가 주인공이 된다.
3. **yaw를 −90°에 놓아 보라.** coxa의 world 회전이 $R_z(90° - 90°) = I$가 되어 coxa 축이 world 축과 나란해진다 — 부모의 회전과 자신의 회전이 곱에서 상쇄되는 것을 눈으로 확인할 수 있다.

트리에서 "임의 두 프레임 사이" 변환은 공통 조상까지 올라갔다 내려오는 곱이다. 라이다가 본 것을 발끝 기준으로 옮기려면 $T_{lidar\_tibia} = T_{base\_lidar}^{-1} \cdot T_{base\_coxa} \cdot T_{coxa\_femur} \cdot T_{femur\_tibia}$ — 올라가는 걸음은 역변환(그래서 SE(3)의 싼 역변환이 중요하다), 내려가는 걸음은 정변환. **tf2가 하는 일이 정확히 이것이다**: 이 트리를 시간축까지 붙여 유지하다가, 요청이 오면 경로를 따라 곱해 준다. [10.7 tf2](#/tf2)에서 그 API를 다룬다.

## 자주 나는 사고 — 역변환 방향 착각

이 수학에서 실제로 가장 잦은 버그는 행렬 곱이 아니라 **방향**이다. $T_{base\_lidar}$가 필요한 자리에 $T_{lidar\_base}$를 꽂는 것 — 위 예제에 한 줄만 잘못 넣어 보자.

```cpp title="lidar_chain.cpp에 추가 (조각)"
// ❌ 사고: "base와 lidar 사이 변환"이라고만 생각하고 방향을 뒤집어 꽂았다
Isometry3d T_lidar_base = T_base_lidar.inverse();
Vector3d p_wrong = (T_world_base * T_lidar_base) * p_lidar;
std::cout << "p_wrong = " << p_wrong.transpose() << "\n";
std::cout << "error   = " << (p_wrong - T_world_lidar * p_lidar).norm() << " m\n";
```

```console
$ ./a.out
p_wrong =  0.04  1.98 0.025
error   = 0.122066 m
```

12 cm 틀렸다. 오차를 뜯어 보면 정확히 마운트 오프셋의 **두 배**다 — 올바른 답은 오프셋 $t$를 더하고, 뒤집힌 변환은 $-t$를 더해서, 차이가 $2\|t\| = 2 \times 0.061 = 0.122$ m. 이 버그의 악질적인 점이 여기 있다: 컴파일은 통과하고, 타입도 맞고, 값도 그럴듯하다. 회전 없는 마운트에서는 좌표 하나 부호가 뒤집힌 정도라, 마운트가 대칭에 가까울수록 시뮬레이션에서도 티가 안 난다. 장애물 지도에 12 cm 오프셋이 생긴 채로 항법이 돌아가다가 좁은 문턱에서야 사고가 난다.

잡는 방법은 위에서 정한 규율 그대로다. $T_{w\_b} \cdot T_{l\_b}$ — 안쪽 인덱스가 b, l로 **맞물리지 않는다.** 변수명이 `T_lidar_base`였다면 곱을 쓰는 순간 어긋남이 보였을 것이고, 코드 리뷰에서도 한 줄 검산으로 잡힌다. 수학이 아니라 이름 짓기가 방어선인, 드물게 공짜인 안전장치다.

## URDF, tf2, 그리고 다음 절

이 절의 수학이 Part X~XI에서 어떤 이름으로 다시 나타나는지 지도를 그려 두자.

- **URDF joint `<origin xyz rpy>`** = $T_{parent\_child}$의 상수 부분. 로봇 모델 파일 전체가 이 절의 트리 하나를 XML로 적은 것이다.
- **tf2의 TF 트리** = 이 트리에 시간축을 붙인 것. 각 변환이 시간의 함수가 되고, 버퍼가 두 시각 사이를 보간한다 — 이동은 선형 보간, 회전은 [9.2](#/rotations)의 slerp. `lookupTransform(target, source)`이 돌려주는 것이 $T_{target\_source}$다. [10.7 tf2](#/tf2)에서 C++ API로 다룬다.
- **다음 절 순기구학** = 이 절 위젯의 다리 체인에서 각 $T_{parent\_child}$의 회전 부분을 관절 각도 $\theta$의 함수로 바꾼 것. 발끝 위치가 $T(\theta_1) \cdot T(\theta_2) \cdot T(\theta_3)$의 곱으로 나온다 — 헥사포드 다리의 발끝이 정확히 이 사슬이다.

## 요약

- 프레임을 하나 건너는 규칙은 $p' = Rp + t$다. 합성하면 $R_2 R_1$과 $R_2 t_1 + t_2$ — 이동은 "돌려서 더해야" 해서 손으로 관리하면 반드시 틀린다.
- 동차 좌표(점 $(x,y,z,1)$)로 올리면 회전+이동이 4×4 행렬 $[R\ t;\ 0\ 1]$ 하나가 되고, 합성이 그냥 행렬 곱이 된다 — 손 공식과 블록 곱의 일치를 diff = 0으로 실측했다.
- 점은 $w=1$, 방향 벡터는 $w=0$ — 이동이 방향에는 자동으로 무시된다. 법선·속도를 점처럼 변환하는 것이 대표 함정이고, `Isometry3d * Vector3d`는 점 취급이므로 방향은 `T.linear() * v`로.
- $[R\ t;\ 0\ 1]$ 전체의 집합이 SE(3)이고, 역변환이 닫힌 형태 $[R^T, -R^T t]$다 — `T.inverse()`와 차이 0, 일반 4×4 역행렬 대비 1.4~1.7배 빠르고 float 큰 이동값에서 4배 정밀함을 실측했다.
- 로봇 코드의 표준 타입은 `Isometry3d`다: `Translation3d * AngleAxisd`로 만들고(순서 뒤집으면 다른 변환), `linear()`/`translation()`으로 읽고, 시작은 반드시 `Identity()`. 메시지와의 다리는 tf2_eigen.
- 표기는 $p_A = T_{A\_B} \cdot p_B$ 하나로 고정한다. 합성은 안쪽 인덱스 도미노($T_{w\_l} = T_{w\_b} \cdot T_{b\_l}$)로 검산하고, 방향 착각(12 cm 오차 실측)은 이 검산과 변수명 규율이 잡는다.
- 프레임 트리 + 경로 곱 + 시간 보간 = tf2. 체인의 회전을 관절각의 함수로 바꾸면 순기구학이다.

::: quiz 연습문제
1~3번은 개념 문제, 4~5번은 네 컴퓨터에서 컴파일이 통과하고 수치가 재현되어야 성공인 실습이다.

1. Nav2가 돌아가는 로봇에는 $T_{map\_odom}$과 $T_{odom\_base}$가 있다. (a) base 좌표로 적힌 점을 map 좌표로 옮기는 변환을 인덱스 도미노가 성립하게 써라. (b) $T_{base\_map}$은 이 둘로 어떻게 만드는가?

2. 4×4 동차 변환에서 두 점의 차 $p - q$에는 이동이 적용되지 않는다. 그 이유를 네 번째 성분으로 설명하고, base 프레임의 속도 벡터를 world 프레임으로 옮기는 올바른 Eigen 한 줄을 써라.

3. $T^{-1}$의 이동 성분은 왜 $-t$가 아니라 $-R^T t$인가? $p' = Rp + t$에서 출발해 유도하라. ($-t$면 어떤 경우에만 우연히 맞는지도 말해 보라.)

4. (실습) `std::vector<Vector3d>`와 `Isometry3d`를 받아 모든 점을 변환해 돌려주는 함수 `transform_points`를 작성하라. 무작위 점 100개를 본문의 `T_world_lidar`로 변환했다가 `T_world_lidar.inverse()`로 되돌려, 원본과의 최대 오차를 출력하라. 컴파일: `g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 roundtrip.cpp && ./a.out`. 성공 기준: 경고 없이 컴파일되고 최대 오차가 $10^{-12}$ 미만이다.

5. (실습) 방향 착각의 오차 구조: 본문의 `lidar_chain.cpp`에서 라이다 마운트를 yaw 180°(뒤를 보는 라이다)로 바꾸고 — `AngleAxisd(pi, Vector3d::UnitZ())` — 올바른 체인과 방향을 뒤집어 꽂은 체인의 오차를 다시 재라. 성공 기준: 회전 없는 마운트에서 $2\|t\| = 0.122$ m였던 오차가 이번엔 얼마가 되는지 실측하고, 오차 벡터가 $t + R^T t$임을 이용해 그 값을 손으로도 설명했다.
:::

::: answer 해설
1. (a) $p_{map} = T_{map\_odom} \cdot T_{odom\_base} \cdot p_{base}$ — 안쪽 인덱스가 odom, base 순서로 도미노처럼 맞물린다. (b) $T_{base\_map} = (T_{map\_odom} \cdot T_{odom\_base})^{-1} = T_{odom\_base}^{-1} \cdot T_{map\_odom}^{-1}$ — 역을 취하면 곱 순서가 뒤집히는 것까지 확인해야 정답이다.
2. 점은 네 번째 성분이 1이므로 $p - q$의 네 번째 성분은 $1 - 1 = 0$ — 방향 벡터의 정의와 일치하고, 4×4 곱에서 이동 열이 0과 곱해져 사라진다. 속도는 위치의 차의 극한이므로 같은 이유로 방향 벡터다: `Vector3d v_world = T_world_base.linear() * v_base;`.
3. $p' = Rp + t$에서 $p' - t = Rp$, 양변에 $R^T$를 곱하면 $p = R^T p' - R^T t$. 역변환의 이동 성분은 "반대로 이동"이 아니라 "반대로 이동한 것을 **되돌린 자세 기준으로** 표현한 것"이라 회전이 끼어든다. $-t$와 우연히 같아지는 것은 $R = I$, 즉 회전 없는 변환뿐이다.
4. 이 환경 실측으로 왕복 최대 오차는 $10^{-16}$ 수준이 나온다 — double 정밀도의 바닥이다. 함수 시그니처에서 벡터를 `const&`로 받는지, 반환을 값으로 하는지([2.7 이동 시맨틱](#/move-semantics) 덕에 값 반환이 사실상 공짜인 것)까지 신경 썼다면 더 좋다.
5. 이 환경 실측: 올바른 답 $(0.04, -1.92, 0.095)$, 뒤집어 꽂은 답 $(0.04, -1.92, 0.025)$ — 오차 **0.07 m, z축뿐이다.** 오차 벡터는 $t + R^T t$인데 $R = R_z(180°)$가 $t$의 x 성분 부호를 뒤집어 $(0.05, 0, 0.035) + (-0.05, 0, 0.035) = (0, 0, 0.07)$ — x 오차는 **상쇄돼 사라진다.** 방향 착각 버그가 마운트 기하에 따라 부분적으로 숨을 수 있다는 것, 그래서 "값이 대충 맞아 보인다"가 검증이 될 수 없고 인덱스 검산이 필요하다는 것이 이 문제의 요점이다.
:::

이 절의 코드는 전부 직접 쳐라. `homogeneous.cpp`로 블록 곱과 손 공식의 diff = 0을 재현하고, `lidar_chain.cpp`는 몸통 yaw를 90° 말고 다른 값으로 바꿔 가며 장애물 world 좌표를 손 검산과 맞춰 봐라. 그다음 ❌ 조각을 붙여 12 cm 오차를 직접 만들어 보고, 퀴즈 5번으로 그 오차가 마운트 회전에 따라 어떻게 숨는지까지 확인해라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 main.cpp && ./a.out` (Eigen 설치는 [9.1](#/eigen) 참고).

**다음 절**: [9.4 순기구학](#/forward-kinematics) — 위젯의 다리 체인에서 각 변환의 회전을 관절 각도의 함수 $T(\theta)$로 바꾸면, 발끝 위치가 관절각 세 개의 함수가 된다. 그 곱의 사슬이 순기구학이다.
