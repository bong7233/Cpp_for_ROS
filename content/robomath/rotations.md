# 9.2 회전 표현: 행렬, 오일러, 쿼터니언

::: lead
3D 공간의 회전은 하나의 수학적 대상이지만, 로봇 소프트웨어는 그것을 세 가지 다른 옷을 입혀 다룬다. URDF는 `rpy="0 0 1.57"`이라고 쓰고, tf2 메시지는 쿼터니언 4개 숫자로 보내고, Eigen 계산은 3×3 행렬로 한다. 셋은 같은 회전의 다른 표현일 뿐인데 저장 크기도, 합성 비용도, 보간 가능성도, 함정의 위치도 전부 다르다. 이 절은 세 표현을 전부 Eigen으로 만들어 보고, 오일러 각의 짐벌 락과 행렬 보간의 실패를 **실제 수치로 재현**한 뒤, 어느 표현을 언제 쓰는지에 대한 실전 기준을 세운다. [9.1 Eigen](#/eigen)의 `Matrix3d`/`Vector3d`를 쓴다.
:::

## 하나의 회전, 세 개의 얼굴

문제부터 보자. 로봇 몸통을 "z축으로 90° 돌린 자세"라고 하자. 이 하나의 사실을 코드에서 마주치는 방식이 최소 세 가지다.

- **URDF/xacro**: `<origin rpy="0 0 1.5708"/>` — roll, pitch, yaw 세 각도.
- **tf2 / geometry_msgs**: `orientation: {x: 0, y: 0, z: 0.7071, w: 0.7071}` — 쿼터니언 4개 성분.
- **Eigen 계산 코드**: 3×3 회전 행렬 — 벡터에 곱해서 실제로 좌표를 돌리는 물건.

왜 하나로 통일하지 않았나? **각 표현이 잘하는 일이 다르기 때문이다.** 아래 표의 수치는 이 절에서 전부 실측으로 확인한다(`sizeof`는 이 환경의 Eigen 3.4.0 실측값).

| 표현 | 저장 | 합성 | 보간 | 특이점 |
| --- | --- | --- | --- | --- |
| 회전 행렬 `Matrix3d` | 9 double, `sizeof` 72 | 행렬 곱 (곱셈 27회) | **불가** — 선형 보간하면 회전이 아니게 된다 | 없음 |
| 오일러 각 (rpy) | 3 double, 24바이트 | **직접 불가** — 행렬/쿼터니언 경유 | 축별 보간은 함정 | **짐벌 락** (pitch = ±90°) |
| 쿼터니언 `Quaterniond` | 4 double, `sizeof` 32 | 쿼터니언 곱 (곱셈 16회) | **slerp** — 유일하게 제대로 된다 | 없음 (q ↔ −q 이중 덮개만 주의) |
| `AngleAxisd` | 축+각, `sizeof` 32 | 직접 불가 | — | 없음 |

그래서 로봇 코드의 일상은 이 표현들 사이의 **변환**이다: 사람이 읽는 설정은 rpy로 받고, 통신·저장은 쿼터니언으로 하고, 벡터를 실제로 돌리는 수학은 행렬로 한다. 이 절의 목표는 각 칸의 "왜"를 수치로 몸에 새기는 것이다.

## 회전 행렬 — SO(3)라는 클럽

3×3 행렬이라고 다 회전이 아니다. 회전 행렬은 두 가지 조건을 만족하는 특별한 행렬이다.

1. **직교(orthogonal)**: $R^T R = I$. 열벡터들이 서로 수직인 단위벡터다 — 회전된 x, y, z축 그 자체다.
2. **행렬식이 +1**: $\det R = 1$. 뒤집기(반사)가 아니라는 뜻이다. $\det R = -1$이면 거울상이 된다.

이 조건을 만족하는 행렬의 집합을 **SO(3)** (Special Orthogonal group, 3차원 특수직교군)라고 부른다. 직접 확인하자.

```cpp title="so3_check.cpp"
#include <Eigen/Dense>
#include <Eigen/Geometry>
#include <iostream>
#include <numbers>

int main() {
    using namespace Eigen;
    constexpr double pi = std::numbers::pi;

    // z축 30도 회전 행렬. AngleAxisd(각도, 회전축)가 행렬 생성의 기본 도구다
    Matrix3d R = AngleAxisd(30.0 * pi / 180.0, Vector3d::UnitZ()).toRotationMatrix();
    std::cout << "R:\n" << R << "\n\n";
    std::cout << "R^T * R:\n" << R.transpose() * R << "\n\n";
    std::cout << "det(R) = " << R.determinant() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 so3_check.cpp && ./a.out
R:
0.866025     -0.5        0
     0.5 0.866025        0
       0        0        1

R^T * R:
1 0 0
0 1 0
0 0 1

det(R) = 1
```

$R^T R = I$라는 건 실무적으로 아주 좋은 소식이기도 하다 — **역행렬이 전치다.** $R^{-1} = R^T$. 일반 행렬의 역행렬 계산(가우스 소거)이 필요 없고, 전치는 사실상 공짜다. "카메라 → 몸통" 변환을 뒤집어 "몸통 → 카메라"를 얻는 일이 로봇 코드에서 매일 일어나는데, 그때마다 전치 한 번이면 끝난다는 뜻이다.

::: note SO(3)의 "군(group)"이 뜻하는 것
회전 두 개를 합성하면(행렬 곱) 결과도 회전이고, 모든 회전에는 역회전이 있고, "안 돌리기"(단위행렬)가 존재한다 — 이 세 성질을 갖춘 집합을 수학에서 군이라 부른다. 이름을 외울 필요는 없지만 ROS 관련 문서·논문에서 SO(3)(회전), SE(3)(회전+이동, [9.3](#/transforms)의 주제)라는 표기가 계속 나오므로 "SO(3) = 유효한 3D 회전 전체"로 읽을 수 있어야 한다.
:::

## 합성은 곱이고, 순서가 전부다

회전 A를 하고 나서 회전 B를 하는 것은 행렬 곱 $B \cdot A$다 (벡터에 $B(Av)$ 순서로 적용되므로 나중 회전이 왼쪽에 붙는다). 그런데 행렬 곱은 **비가환**이다 — $AB \ne BA$. 회전에서 이건 수학의 트집이 아니라 물리적 사실이다. 폰을 손에 들고 "앞으로 90° 굴리기 → 시계방향 90° 돌리기"와 그 반대 순서를 해 보면 최종 자세가 다르다. 수치로 보자.

```cpp title="noncommute.cpp (조각 — main과 include는 위 파일과 동일)"
Matrix3d Rz90 = AngleAxisd(pi / 2, Vector3d::UnitZ()).toRotationMatrix();
Matrix3d Rx90 = AngleAxisd(pi / 2, Vector3d::UnitX()).toRotationMatrix();
Vector3d v(1, 0, 0);
std::cout << (Rz90 * Rx90 * v).transpose() << "\n";
std::cout << (Rx90 * Rz90 * v).transpose() << "\n";
```

```console
$ ./a.out
6.12323e-17           1           0
6.12323e-17 6.12323e-17           1
```

같은 벡터 $(1,0,0)$이 곱셈 순서에 따라 **y축 방향**이 되기도 하고 **z축 방향**이 되기도 한다. 완전히 다른 결과다. (`6.12323e-17`은 0이다 — $\cos(90°)$를 double로 계산한 잔여물. 부동소수점의 이 습성은 [9.8 수치 안정성](#/numerics)에서 제대로 다룬다.)

이 "회전이 프레임에 하는 일"을 눈으로 확인하자. 아래 위젯의 **yaw 슬라이더**를 돌려 보라. `base_link`가 돌면 그 위에 붙은 `lidar`와 `leg_coxa`가 통째로 따라 돈다 — 부모 프레임의 회전이 자식에게 곱으로 전파되는 것, 이게 다음 절 [9.3 동차 변환](#/transforms)과 [10.7 tf2](#/tf2)의 뼈대다.

::: widget frame-transform-3d
{ "frames": [
    { "name": "base_link", "parent": "world", "xyz": [0, 0, 60], "rpy": [0, 0, 0] },
    { "name": "lidar", "parent": "base_link", "xyz": [50, 0, 35], "rpy": [0, 0, 0] },
    { "name": "leg_coxa", "parent": "base_link", "xyz": [45, 40, -10], "rpy": [0, 0, 0.5236] }
  ],
  "interactive": "base_link" }
:::

위젯 캡션에 나오는 world 기준 회전 행렬이 방금 배운 그 3×3 행렬이다. yaw를 90°로 놓으면 첫 두 열이 자리를 바꾸는 것(x축이 y방향으로, y축이 −x방향으로)을 캡션 수치로 직접 확인하라.

## 오일러 각 — 사람의 언어

행렬은 계산엔 좋지만 사람이 읽을 수 없다. 9개 숫자를 보고 "아 이건 약간 기울어진 자세군"이라고 읽는 사람은 없다. 그래서 사람 접점(설정 파일, 디버그 출력, 튜닝)에는 **오일러 각**을 쓴다: 세 축에 대한 세 번의 회전으로 자세를 기술한다.

ROS 세계의 관례는 **REP-103**이 정한다: x 전방, y 좌측, z 상방 좌표계에서 **roll(x축), pitch(y축), yaw(z축)**. URDF의 `rpy` 속성이 정확히 이것이고, 적용 순서는 **고정된 월드 축 기준으로 roll → pitch → yaw** (외인성, extrinsic)다. 행렬로는 나중 회전이 왼쪽에 붙으므로:

$$R = R_z(\text{yaw}) \cdot R_y(\text{pitch}) \cdot R_x(\text{roll})$$

Eigen에는 "rpy로 행렬 만들기" 전용 함수가 없다. `AngleAxisd` 셋을 곱하는 것이 관용구다.

```cpp title="rpy_to_matrix.cpp (조각)"
// URDF rpy 관례: 고정 축 X(roll) -> Y(pitch) -> Z(yaw) = Rz * Ry * Rx
Matrix3d R = (AngleAxisd(yaw,   Vector3d::UnitZ())
            * AngleAxisd(pitch, Vector3d::UnitY())
            * AngleAxisd(roll,  Vector3d::UnitX())).toRotationMatrix();
```

::: warn 오일러 각은 "오일러 각"이라는 말만으로는 정의되지 않는다
축 순서(XYZ, ZYX, ZXZ...)와 기준(고정 월드 축 extrinsic vs 매번 따라 도는 몸통 축 intrinsic)의 조합이 12가지가 넘고, 분야마다 관례가 다르다(항공은 intrinsic ZYX를 즐겨 쓴다). 다행히 "extrinsic XYZ"와 "intrinsic ZYX"는 같은 행렬이 되므로 ROS의 rpy는 두 방식 어느 쪽으로 읽어도 된다. 하지만 다른 라이브러리·논문의 오일러 각을 받아올 때는 **반드시 순서와 기준부터 확인하라.** 각도 세 개가 맞는데 자세가 이상하면 십중팔구 이 문제다.
:::

역방향, 즉 행렬에서 각도를 뽑는 것은 `R.eulerAngles(2, 1, 0)`이다 — 인자는 축 인덱스(2=z, 1=y, 0=x)이고 **반환 순서도 (yaw, pitch, roll)**, rpy의 역순이다. 정상 케이스에서는 왕복이 된다.

```console
$ ./a.out
normal rpy(0.3, 0.7, 0.5) -> eulerAngles(2,1,0) = 0.5 0.7 0.3  (yaw pitch roll)
```

들어간 각도가 그대로 나왔다. 그런데 이 왕복에는 조건이 붙어 있다.

## 짐벌 락을 재현한다

pitch를 정확히 90°로 세워 보자. rpy = (0.3, π/2, 0.5)로 행렬을 만들고 다시 각도를 뽑는다.

```cpp title="gimbal.cpp"
#include <Eigen/Dense>
#include <Eigen/Geometry>
#include <iostream>
#include <numbers>

int main() {
    using namespace Eigen;
    constexpr double pi = std::numbers::pi;
    auto rpy_to_R = [](double roll, double pitch, double yaw) {
        return (AngleAxisd(yaw,   Vector3d::UnitZ())
              * AngleAxisd(pitch, Vector3d::UnitY())
              * AngleAxisd(roll,  Vector3d::UnitX())).toRotationMatrix();
    };

    Matrix3d Rg = rpy_to_R(0.3, pi / 2, 0.5);
    Vector3d e = Rg.eulerAngles(2, 1, 0);              // (yaw, pitch, roll)
    std::cout << "extracted (yaw pitch roll) = " << e.transpose() << "\n";
    std::cout << "yaw - roll = " << e[0] - e[2] << "\n";

    // 뽑힌 각도로 다시 만들면 같은 회전인가?
    Matrix3d R2 = rpy_to_R(e[2], e[1], e[0]);
    std::cout << "||Rg - R2|| = " << (Rg - R2).norm() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 gimbal.cpp && ./a.out
extracted (yaw pitch roll) =   0.205395     1.5708 0.00539539
yaw - roll = 0.2
||Rg - R2|| = 6.57989e-16
```

넣은 각도는 (roll 0.3, yaw 0.5)인데 나온 각도는 (roll 0.005, yaw 0.205)다. **원래 각도가 복원되지 않았다.** 그런데 마지막 줄 — 그 "틀린" 각도로 행렬을 다시 만들면 원래 행렬과 오차 $10^{-16}$, 즉 **완전히 같은 회전**이다. 각도 조합은 다른데 회전은 같다. 어떻게?

`yaw - roll = 0.2`가 열쇠다. 원래 넣은 값도 $0.5 - 0.3 = 0.2$. pitch가 정확히 90°가 되는 순간, **roll 축(몸통 x축)이 회전해 올라와 yaw 축(월드 z축)과 같은 직선 위에 눕는다.** 서로 다른 두 회전축이어야 할 것이 하나로 겹쳐서, roll과 yaw가 각각 얼마인지는 의미를 잃고 **차이만 회전에 남는다.** 자유도 3개 중 1개가 증발한 것 — 이것이 **짐벌 락(gimbal lock)**이다. 실제로 이 환경에서 rpy(0.5, π/2, 0.5)와 rpy(0.3, π/2, 0.3)의 행렬 차 노름을 재면 $3.9 \times 10^{-17}$, 동일한 회전이다 — roll에 더한 0.2를 yaw에서 빼도 티가 안 난다.

```text nolines
pitch = 0                          pitch = +90 deg
                                                        
      z  (yaw axis)                      z  (yaw axis)
      ^                                  ^
      |                                  #  <- body x (roll axis), now
      o-----> y                          #     lying on the yaw axis:
     /                                   o-----> y
    x  (roll axis)                          two axes, one direction
```

중요한 정리: **짐벌 락은 회전 자체의 결함이 아니라 rpy라는 "좌표계"의 결함이다.** 회전 행렬 Rg는 멀쩡하고, 그 자세에서 로봇도 멀쩡히 움직일 수 있다. 고장 나는 것은 "이 회전을 세 각도로 유일하게 기술하기"다. 지도 투영에서 북극점의 경도가 정의되지 않는 것과 정확히 같은 종류의 문제다 — 북극이 이상한 게 아니라 경위도라는 표현이 거기서 퇴화한다.

::: danger eulerAngles() 왕복을 믿는 코드는 언젠가 깨진다
"쿼터니언 → 오일러로 바꿔 저장했다가 → 다시 쿼터니언으로 복원"하는 코드는 pitch가 90° 근처를 지나는 순간 각도가 널뛴다. 게다가 Eigen의 `eulerAngles(2,1,0)`는 첫 각도를 $[0, \pi]$ 범위로 강제하기 때문에 특이점 근처가 아니어도 놀랄 수 있다 — 이 환경에서 yaw = −2.5 하나짜리 회전을 왕복하면 `(0.641593, -3.14159, 3.14159)`가 나온다. $\pi - 2.5 = 0.6416$에 pitch·roll이 ±π로 뒤집힌, **같은 회전의 다른 각도 조합**이다. 각도 수치가 연속적으로 유지돼야 하는 곳(제어 루프, 로그, 필터 상태)에 `eulerAngles()` 출력을 그대로 넣지 마라. 내부 상태는 쿼터니언이나 행렬로 들고, 오일러는 사람에게 보여줄 때만 만든다.
:::

::: interview "짐벌 락이 뭐고, 왜 쿼터니언을 쓰나"
로보틱스·게임·항공 분야 면접의 단골이다. 모범 답변의 뼈대: ① 오일러 각은 세 번의 축 회전으로 자세를 표현하는데, 가운데 축이 ±90°가 되면 첫 번째와 세 번째 회전축이 겹쳐 자유도 하나가 사라진다 — 이것이 짐벌 락이고, 회전이 아니라 **표현의 특이점**이다. ② 그 자세 근처에서는 작은 자세 변화가 각도 공간에서 불연속 점프로 나타나 보간·제어·필터가 전부 오염된다. ③ 쿼터니언은 4개 성분으로 한 겹 여유를 두어 특이점이 없고, 합성이 싸고, slerp로 보간이 되며, 정규화 한 번으로 수치 드리프트를 복구할 수 있어 내부 표현의 표준이다. ④ 대가는 직관성 — 그래서 실무는 "내부는 쿼터니언, 사람 접점은 오일러"로 역할을 나눈다. 여기까지 말하면 충분하고, "q와 −q가 같은 회전(이중 덮개)"까지 덧붙이면 확실히 통과다.
:::

## 쿼터니언 — 특이점 없는 4개의 숫자

쿼터니언은 숫자 4개 $(w, x, y, z)$로 회전을 표현한다. 축 $\hat{u}$ 둘레로 각도 $\theta$만큼 도는 회전은:

$$q = \left(\cos\tfrac{\theta}{2},\; \hat{u}\sin\tfrac{\theta}{2}\right)$$

**반각**이 들어가는 것에 주목하라. z축 90° 회전이면 $\cos 45° = \sin 45° = 0.7071$:

```cpp title="quat_basics.cpp (조각)"
Quaterniond q(AngleAxisd(pi / 2, Vector3d::UnitZ()));
std::cout << q.w() << " " << q.x() << " " << q.y() << " " << q.z()
          << ", norm=" << q.norm() << "\n";
std::cout << (q * Vector3d(1, 0, 0)).transpose() << "\n";   // 벡터 회전은 그냥 *
```

```console
$ ./a.out
0.707107 0 0 0.707107, norm=1
2.22045e-16           1           0
```

geometry_msgs에서 봤을 그 `{z: 0.7071, w: 0.7071}`이 바로 이 값이다. 회전을 나타내는 쿼터니언은 **단위 쿼터니언**(norm = 1)이어야 한다 — 4차원 단위 구면 위의 점 하나가 회전 하나에 대응한다(정확히는 두 점이. 곧 본다).

합성은 쿼터니언 곱 `q2 * q1`(행렬처럼 나중 회전이 왼쪽)이고, 결과는 행렬 곱과 정확히 일치한다. 이 환경 실측으로 `Quaterniond(qz * qx).toRotationMatrix()`와 `Rz90 * Rx90`의 차 노름은 $3.2 \times 10^{-16}$ — 같은 물건이다. 곱셈 횟수는 쿼터니언 곱이 16회로 행렬 곱 27회보다 싸고, 무엇보다 저장이 4개 값이라 메시지로 보내기 좋다.

그리고 실측에서 하나 더 — q의 부호를 전부 뒤집은 −q로 같은 벡터를 돌려 보면:

```console
q * v  = 2.22045e-16           1           0
-q * v = 2.22045e-16           1           0
||R(q) - R(-q)|| = 0
angularDistance(q, -q) = 0
```

**q와 −q는 같은 회전이다.** 회전 행렬로 바꾸면 비트 단위로 같고, 각도 거리도 0이다. 반각 공식에서 $\theta$ 대신 $\theta + 2\pi$(같은 회전)를 넣으면 부호가 뒤집히기 때문이다. 이를 **이중 덮개(double cover)**라 한다 — 단위 쿼터니언 구면이 회전 공간을 두 겹으로 덮는다.

::: deep 이중 덮개가 실무를 무는 지점
"같은 회전이면 그만 아닌가?"— 회전 하나만 보면 그렇다. 무는 것은 **두 쿼터니언을 비교·보간할 때**다. 물리적으로 5°밖에 차이 안 나는 두 자세가 부호 반대 진영에 있으면 성분 차이는 거대해 보이고, 순진한 보간은 355°를 도는 먼 길을 택한다. 그래서 slerp 구현들은 내적이 음수면 한쪽 부호를 뒤집어 "가까운 쪽"으로 보간한다(Eigen의 `slerp`도 내부에서 이 처리를 한다). 직접 쿼터니언 오차를 계산하는 코드(자세 제어기, EKF 갱신)를 쓸 때는 이 처리를 **당신이** 해야 한다 — `if (q1.dot(q2) < 0) q2.coeffs() = -q2.coeffs();`. [9.6 상태 추정](#/state-estimation)에서 다시 만난다.
:::

::: hist 1843년, 다리 위의 낙서에서 rclcpp까지
쿼터니언은 해밀턴(W. R. Hamilton)이 1843년 더블린의 브룸 다리에서 $i^2 = j^2 = k^2 = ijk = -1$을 떠올리고 다리 난간에 새겼다는 그 수 체계다. 이후 벡터 해석에 밀려 한 세기 가까이 잊혔다가, 우주선 자세 제어(1960년대)와 컴퓨터 그래픽스(1985년 slerp 논문)가 "특이점 없고 보간되는 회전 표현"을 필요로 하면서 부활했다. 오늘날 ROS 메시지의 `orientation` 필드가 쿼터니언인 것은 이 부활의 직계 후손이다.
:::

## 보간: slerp가 필요한 이유

로봇 팔의 끝을 자세 A에서 자세 B로 1초 동안 **부드럽게** 돌리고 싶다. 중간 자세들을 만들어야 한다. 행렬로 해 보자 — A와 B를 성분별로 섞으면($ (1-t)R_A + tR_B $) 되지 않을까?

```console
$ ./a.out
0.5*I + 0.5*Rz90: det=0.5
lerp t=0.25 (0 -> 180deg): det=0.25, ||Rm^T*Rm - I|| = 1.06066
lerp t=0.5  (0 -> 180deg): det=3.7494e-33, ||Rm^T*Rm - I|| = 1.41421
```

안 된다. 단위행렬과 z축 90° 행렬의 중간 지점부터 이미 $\det = 0.5$ — SO(3) 클럽에서 쫓겨났다. 이 행렬을 벡터에 곱하면 회전이 아니라 **찌그러뜨리고 축소하는** 변환이 된다. 극단인 0° → 180° 보간의 중간에서는 $\det \approx 0$, 3D 공간을 평면으로 뭉개 버리는 행렬이 나온다. 행렬의 9개 성분은 서로 직교 제약으로 묶여 있어서 성분별 직선 이동은 곧바로 제약을 깬다.

쿼터니언은 이 문제를 우아하게 푼다. 단위 쿼터니언은 4차원 구면 위의 점이므로, 두 점을 **구면 위의 대원(great circle)을 따라** 걷게 하면 모든 중간점도 단위 쿼터니언 = 유효한 회전이다. 이것이 **slerp**(spherical linear interpolation)다.

```cpp title="slerp.cpp (조각)"
Quaterniond q0 = Quaterniond::Identity();
Quaterniond q1(AngleAxisd(pi, Vector3d::UnitZ()));       // 180도
for (double t : {0.0, 0.25, 0.5, 0.75, 1.0}) {
    AngleAxisd aa(q0.slerp(t, q1));                       // 중간 자세를 축-각으로 해석
    std::cout << "t=" << t << ": " << aa.angle() * 180 / pi << " deg\n";
}
```

```console
$ ./a.out
t=0: 0 deg      t=0.25: 45 deg      t=0.5: 90 deg      t=0.75: 135 deg      t=1: 180 deg
```

모든 중간 자세의 norm이 1(실측)이고, 각도가 t에 **정비례**한다 — 등속 회전이다. 행렬 lerp가 아예 회전이 아니게 되던 그 0° → 180° 문제를, slerp는 45° 간격의 완벽한 등속 경로로 푼다. 궤적 보간, 애니메이션, tf2의 시간 보간([10.7](#/tf2)에서 `lookupTransform`이 두 시각 사이 변환을 보간할 때)이 전부 이 연산 위에 서 있다.

## 표현 간 변환 레시피

로봇 코드에서 매일 쓰는 변환 전부다. Eigen은 생성자와 대입으로 대부분을 처리한다 — 손으로 칠 것.

```cpp title="conversions.cpp — 상호 변환 총정리"
#include <Eigen/Dense>
#include <Eigen/Geometry>
#include <iostream>
#include <numbers>

int main() {
    using namespace Eigen;
    constexpr double pi = std::numbers::pi;
    double roll = 0.3, pitch = 0.7, yaw = 0.5;

    // rpy -> 쿼터니언 (URDF/REP-103 관례). rpy -> 행렬도 같은 식에 toRotationMatrix()
    Quaterniond q = AngleAxisd(yaw,   Vector3d::UnitZ())
                  * AngleAxisd(pitch, Vector3d::UnitY())
                  * AngleAxisd(roll,  Vector3d::UnitX());

    Matrix3d R = q.toRotationMatrix();      // 쿼터니언 -> 행렬
    Quaterniond q2(R);                      // 행렬 -> 쿼터니언 (생성자)
    AngleAxisd aa(q);                       // 쿼터니언 -> 축-각 (행렬도 동일)
    Vector3d ypr = R.eulerAngles(2, 1, 0);  // 행렬 -> (yaw, pitch, roll) — 순서 주의!

    std::cout << "quat (w x y z): " << q.w() << " " << q.x() << " "
              << q.y() << " " << q.z() << "\n";
    std::cout << "roundtrip diff: " << (q.coeffs() - q2.coeffs()).norm() << "\n";
    std::cout << "axis-angle: " << aa.angle() << " rad, axis " << aa.axis().transpose() << "\n";
    std::cout << "back to rpy: " << ypr[2] << " " << ypr[1] << " " << ypr[0] << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 conversions.cpp && ./a.out
quat (w x y z): 0.912838 0.0166081 0.35276 0.204718
roundtrip diff: 1.11886e-16
axis-angle: 0.842262 rad, axis 0.127528 0.888561 0.440677
back to rpy: 0.3 0.7 0.5
```

`AngleAxisd`는 중간 다리로 특히 유용하다 — "어떤 축으로 몇 도"라는 사람의 말을 그대로 코드로 옮기는 타입이고, 행렬로도 쿼터니언으로도 곱 한 번에 흡수된다.

::: danger Eigen 쿼터니언의 성분 순서는 두 얼굴이다
이 환경 실측: `Quaterniond q(0.1, 0.2, 0.3, 0.4)`로 만들면 `q.w() == 0.1` — **생성자는 (w, x, y, z) 순서**다. 그런데 `q.coeffs()`를 찍으면 `0.2 0.3 0.4 0.1` — **내부 저장과 coeffs()는 (x, y, z, w) 순서**다. 그리고 geometry_msgs의 Quaternion 필드 순서도 x, y, z, w다. 즉 ROS 메시지 ↔ Eigen을 손으로 옮길 때 생성자 순서로 착각하면 **컴파일은 통과하고 자세만 조용히 틀리는** 최악의 버그가 된다. 필드 이름(`q.x() = msg.x` 식)으로 옮기거나 `tf2_eigen`의 변환 함수를 쓰고, 위치 인자 네 개를 나열하는 코드는 리뷰에서 잡아라.
:::

::: tip 정규화는 받는 쪽의 책임이다
메시지·파일에서 들어온 쿼터니언은 단위라는 보장이 없다(직렬화 반올림, 손으로 쓴 yaml, 버그). 회전으로 쓰기 전에 `q.normalize()` 한 번이 관행이다. tf2는 아예 norm이 1에서 벗어난 쿼터니언 입력을 에러로 거부한다. 비용은 아래에서 실측하듯 나노초 단위 — 아끼지 마라.
:::

## 수치 드리프트 — 왜 오도메트리는 쿼터니언인가

오도메트리는 "직전 자세 × 작은 증분"을 초당 수백 번, 몇 시간씩 누적한다. 부동소수점 곱셈마다 반올림 오차가 끼는데, 그 오차는 표현을 SO(3) 밖으로 조금씩 밀어낸다. 작은 회전을 100만 번 곱해 보자.

```cpp title="drift.cpp (조각) — float로 100만 번 누적"
Matrix3f dR = AngleAxisd(0.001, Vector3d(1, 2, 3).normalized())
                  .toRotationMatrix().cast<float>();
Matrix3f R = Matrix3f::Identity();
Quaternionf dq(dR), q = Quaternionf::Identity();
for (int i = 0; i < 1'000'000; ++i) { R = R * dR; q = q * dq; }
```

```console
$ ./a.out
float, after 1000000 multiplies:
  matrix: det(Rf) = 0.980109, ||Rf^T Rf - I|| = 0.0236869
  quat:   norm(qf) = 1.00313
double, after 1000000 multiplies:
  matrix: det(R) = 1 + 1.58e-11,  quat: norm(q) = 1 + 4.29e-11
```

float 기준으로 행렬의 $\det$가 1에서 **2% 이탈**했다 — 이 행렬은 더 이상 회전이 아니라 매번 벡터를 2%씩 수축시키는 변환이고, 직교성 오차 0.024만큼 축들도 비뚤어졌다. 쿼터니언도 norm이 1.003으로 흘렀다 — 드리프트 자체는 양쪽 다 생긴다. (double이면 100만 번에 $10^{-11}$ 수준이라 훨씬 여유롭지만, 방향은 같다. 임베디드 보드에서 float를 쓰는 순간 이 문제는 현실이 된다.)

차이는 **복구 비용**이다. 쿼터니언은 `q.normalize()` — 4개 성분을 norm으로 나누는 것 — 로 정확히 단위 구면에 돌아온다. 행렬은 9개 성분을 "가장 가까운 회전 행렬"로 되돌려야 하는데, 제대로 하려면 SVD를 돌려 $UV^T$를 취해야 한다. 둘을 실측하면:

::: perf 재정규화 비용 실측 (g++ 13 / -O2 / Eigen 3.4.0 / x86-64, 10만 회 평균)
- 쿼터니언 `normalize()`: **16 ns/회**
- 행렬 SVD 직교화 (`JacobiSVD` 후 $UV^T$): **621 ns/회** — 약 **39배**

절대값은 기기마다 다르지만 자릿수 차이는 구조적이다: 한쪽은 나눗셈 4번, 다른 쪽은 반복적 행렬 분해다. 제어 주기마다 재정규화해도 쿼터니언은 예산에 안 잡히는 수준이고, 그래서 IMU 필터·오도메트리·EKF의 자세 상태는 거의 예외 없이 쿼터니언이다. Hexpider의 leg odometry가 몸통 자세를 누적할 때도 같은 이유로 쿼터니언을 쓴다.
:::

## 로봇 코드 실전 — 어느 표현을 언제

이 절 전체를 한 표로 접는다. 실무 기준은 명확하다.

| 상황 | 표현 | 이유 |
| --- | --- | --- |
| URDF/설정 파일, 사람이 읽는 로그 | 오일러 rpy | 사람이 읽고 쓸 수 있는 유일한 표현 |
| 메시지 통신, 자세 상태 저장, 누적 | 쿼터니언 | 작고(4값), 특이점 없고, 재정규화가 싸다 |
| 벡터를 실제로 돌리는 수학, 여러 점 일괄 변환 | 행렬 | 곱 한 번에 점 하나, 여러 점이면 행렬-행렬 곱으로 일괄 처리 |
| "이 축으로 이만큼" 한 번 회전 만들기 | `AngleAxisd` | 의도가 코드에 그대로 보인다 |
| 보간, 궤적, 시간 동기화 | 쿼터니언 slerp | 유일하게 올바른 회전 보간 |

ROS 2 스택이 정확히 이 분업을 따른다: URDF가 rpy로 쓰고 → 파서가 쿼터니언으로 바꿔 tf2에 넣고 → tf2가 쿼터니언으로 전파·보간하고 → 당신의 노드가 Eigen 행렬로 바꿔 실제 계산을 한다. [10.7 tf2](#/tf2)에서 이 파이프라인의 API를, 다음 절 [9.3](#/transforms)에서 회전에 이동까지 합친 4×4 동차 변환을 다룬다 — 위 위젯 캡션에 이미 나오던 $T_{world \to c} = T_{world \to p} \cdot T_{p \to c}$가 그 주제다.

## 요약

- 회전 행렬은 $R^T R = I$, $\det R = 1$인 SO(3)의 원소다. 역행렬이 전치라 뒤집기가 공짜다.
- 회전 합성은 곱이고 **비가환**이다 — $R_z R_x \ne R_x R_z$를 실측으로 확인했다. 곱 순서가 곧 회전 순서다.
- 오일러 rpy(REP-103: x-roll, y-pitch, z-yaw)는 사람의 언어다. pitch = ±90°에서 roll·yaw 축이 겹쳐 자유도를 잃는 **짐벌 락**이 생기고, `eulerAngles()` 왕복은 같은 회전의 다른 각도 조합을 돌려줄 수 있다.
- 쿼터니언은 반각 기반 4개 성분, 특이점이 없고, q와 −q가 같은 회전(이중 덮개)이다. 내부 상태·통신·누적의 표준 표현이다.
- 회전 보간은 slerp만 옳다. 행렬 성분 보간은 $\det$가 1에서 무너져 회전이 아니게 된다 (0°→180° 중간에서 $\det \approx 0$ 실측).
- 반복 누적은 어떤 표현이든 수치 드리프트를 만든다(float 100만 곱에 행렬 $\det$ 2% 이탈 실측). 쿼터니언은 16 ns짜리 `normalize()`로 복구되고, 행렬은 SVD(39배 비용)가 필요하다 — 오도메트리가 쿼터니언인 이유다.
- Eigen 레시피: rpy → `AngleAxisd` 곱, 행렬↔쿼터니언은 생성자/`toRotationMatrix()`, 각도 추출은 `eulerAngles(2,1,0)`. 생성자는 (w,x,y,z), `coeffs()`와 ROS 메시지는 (x,y,z,w) — 순서 사고를 조심하라.

::: quiz 연습문제
1~3번은 개념·예측 문제, 4~5번은 네 컴퓨터에서 컴파일이 통과하고 수치가 재현되어야 성공인 실습이다.

1. 어떤 3×3 행렬 M이 $M^T M = I$를 만족하는데 $\det M = -1$이다. M은 회전인가? 아니라면 M을 벡터들에 적용했을 때 어떤 일이 벌어지는지 한 문장으로 설명하라.

2. 본문 실측에서 rpy(0.3, π/2, 0.5)를 `eulerAngles(2,1,0)`로 왕복하면 (yaw 0.205, pitch 1.571, roll 0.005)가 나왔다. 이 각도로 재조립한 행렬이 원본과 일치했던 이유를 "보존되는 양"을 들어 설명하라. pitch가 −90°라면 보존되는 양은 무엇일지 예측해 보라.

3. 자세 오차를 계산하는 코드가 `err = (q_target.coeffs() - q_current.coeffs()).norm()`으로 되어 있다. 물리적으로 거의 같은 자세인데 err가 2에 가깝게 나오는 경우가 있다. 왜인가? 올바른 비교 방법을 제시하라.

4. (실습) 드리프트 재현: 본문의 `drift.cpp` 조각을 완결된 프로그램으로 작성하되, float와 double 두 벌로 각각 100만 회 누적한 뒤 행렬 `determinant()`와 쿼터니언 `norm()`을 출력하라. 매 1000회마다 쿼터니언만 `normalize()`하는 세 번째 변형을 추가하라. 컴파일: `g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 drift.cpp && ./a.out`. 성공 기준: ① float 행렬의 det가 1에서 눈에 띄게 이탈하고 ② 주기적으로 정규화한 쿼터니언은 norm이 1.0에 붙어 있는 것을 직접 확인했다.

5. (실습) rpy → geometry_msgs 순서 함정: rpy(0.1, 0.2, 0.3)를 쿼터니언으로 바꾸고, geometry_msgs 필드 순서인 (x, y, z, w) 순으로 한 줄에 출력하는 함수 `void print_msg_order(double roll, double pitch, double yaw)`를 작성하라. 성공 기준: 출력의 **마지막** 값이 0.98 근처(w 성분)이고, `q.coeffs().transpose()` 출력과 순서가 일치함을 확인했다. 그다음 일부러 `Quaterniond(q.x(), q.y(), q.z(), q.w())`로 "잘못 재구성"한 쿼터니언으로 (1,0,0)을 돌려 보고, 원본과 결과가 어떻게 다른지 기록하라.
:::

::: answer 해설
1. 회전이 아니다. $\det = -1$인 직교 행렬은 **반사(거울상)**를 포함한다 — 오른손 좌표계를 왼손 좌표계로 뒤집으므로, 강체가 물리적으로 도달할 수 없는 자세를 만든다(왼손 장갑을 회전만으로 오른손 장갑으로 만들 수 없는 것과 같다). 센서 캘리브레이션 행렬에서 이게 나오면 축 하나의 부호가 잘못 잡힌 것이다.
2. 짐벌 락에서 roll 축이 yaw 축 위에 눕기 때문에 개별 각도는 의미를 잃고 **yaw − roll = 0.2**만 회전에 남는다. 추출된 각도도 $0.205 - 0.005 = 0.2$로 이 값을 보존하므로 같은 회전이 재조립된다. pitch = −90°에서는 roll 축이 yaw 축과 반대 방향이 아니라 같은 방향으로 눕는 기하가 되어 **yaw + roll**이 보존되는 양이 된다 (직접 rpy(0.3, −π/2, 0.5)로 확인해 보라).
3. 이중 덮개 때문이다. q와 −q는 같은 회전이므로 q_current가 −q_target 근처 값으로 수렴해 있으면 성분 차 norm은 최대 2까지 커진다. 올바른 방법: 비교 전에 `if (q_target.dot(q_current) < 0)` 한쪽 부호를 뒤집거나, 성분 차가 아니라 `q_target.angularDistance(q_current)`(상대 회전의 실제 각도)를 쓴다.
4. 이 환경 실측 기준 float는 det ≈ 0.9801(2% 이탈), double은 det − 1 ≈ 1.6 × 10⁻¹¹이 나온다. 주기 정규화 변형은 norm이 항상 1.0에 붙어 있어야 한다 — normalize() 비용(이 환경 16 ns)이 사실상 공짜라서 "매번 정규화"가 실무 기본값이라는 것까지 체감하는 것이 목적이다. 수치는 기기·컴파일 옵션에 따라 조금 다르지만 float/double의 자릿수 차이는 같다.
5. 올바른 출력은 `0.0342708 0.106021 0.143572 0.983347`처럼 w가 마지막이고, 이는 `q.coeffs()` 순서와 같다. `Quaterniond(q.x(), q.y(), q.z(), q.w())`는 x를 w 자리에 넣는 재구성이라 **완전히 다른 회전**이 된다 — 게다가 norm은 여전히 1이라 정규화 검사로도 안 잡힌다. 컴파일러도, tf2의 norm 체크도 침묵하는 버그라서 필드 이름으로 옮기는 습관만이 방어책이라는 것이 이 문제의 요점이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `gimbal.cpp`는 pitch를 π/2에서 1.4, 1.5, 1.5707로 조금씩 올려 가며 추출 각도가 어느 지점부터 널뛰는지 관찰하고, `drift.cpp`는 float/double 두 벌을 꼭 다 돌려 자릿수 차이를 눈으로 봐라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -O2 -I/usr/include/eigen3 main.cpp && ./a.out` (Eigen 헤더 경로는 [9.1](#/eigen) 참고, 우분투 기준 `sudo apt install libeigen3-dev`).

**다음 절**: [9.3 동차 변환과 좌표 프레임](#/transforms) — 회전에 이동을 합쳐 4×4 행렬 하나로 만들면, 위젯에서 본 "부모가 움직이면 자식이 통째로 따라온다"가 행렬 곱 하나로 표현된다. TF 트리의 수학이 시작된다.
