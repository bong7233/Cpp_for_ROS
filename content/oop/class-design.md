# 3.8 클래스 설계 실전

::: lead
3.1~3.7은 결정 하나씩을 따로 배웠다 — 불변식을 지키는 캡슐화(3.1), 생성 순서(3.2), 상속의 비용(3.3), 값 타입 연산자(3.6), 상속과 컴포지션을 가르는 기준(3.7). 실전에서는 이 결정들이 한꺼번에, 순서를 정해서 내려져야 하는 클래스 하나로 뭉친다. 이 절은 헥사포드 다리 하나를 제어하는 `LegController`를 처음부터 설계하면서 그 순서를 보여준다. 새로 배우는 것은 하나뿐이다 — **const 정확성(const-correctness)**. 나머지는 전부 지금까지 배운 결정 기준을 실제 클래스에 적용하는 연습이다.
:::

## 문제: 다리 하나를 제어하는 클래스

헥사포드 다리 하나(coxa-femur-tibia 3관절)를 제어하는 클래스가 필요하다. 요구사항은 이렇다.

- 관절 세 개 각각 물리적 각도 한계가 있고, 그 한계를 벗어나는 값이 액추에이터로 나가면 안 된다.
- 몸체의 기울기를 알아야 한다 — IMU 센서의 자세값을 참조해야 발끝 위치 보정이 가능하다. IMU는 다리 하나의 소유물이 아니라 몸체 전체가 갖고 6개 다리가 공유한다.
- 6개 다리를 벡터 하나에 담아 반복문 하나로 갱신해야 한다 — 호출하는 쪽이 "이게 실제 하드웨어 다리인지 시뮬레이션 다리인지" 몰라도 되어야 한다.
- 복사되면 안 된다. 다리 하나에 컨트롤러 인스턴스가 두 개 생기면 액추에이터에 서로 다른 목표값을 내려보내는 명령 충돌이 생긴다 — [2.9](#/unique-ptr)에서 `unique_ptr`가 "소유자가 하나"를 강제한 것과 같은 이유로, `LegController` 자신도 하나여야 한다.

이 넷을 순서대로 처리한다. 다만 그 전에 이 클래스를 관통하는 새 습관 하나부터 본다 — 지금까지 예제 곳곳에서 `const`를 붙여 왔지만, 그 `const`가 어디까지 지켜 주고 어디서부터 안 지켜 주는지는 아직 정식으로 다루지 않았다.

## const 정확성: 붙이는 습관과 그게 지켜 주지 않는 것

**const 정확성**이란 멤버 함수마다 "이 함수가 객체를 바꾸는가"를 `const` 유무로 정확히 표시하는 습관이다. [3.1](#/classes)에서 "읽기만 하면 붙인다"는 규칙만 봤다면, 실전 클래스에서는 이 규칙이 두 가지 함정과 부딪힌다.

### 얕은 const의 함정: 포인터 멤버는 안 따라간다

`LegController`가 IMU를 참조해야 한다는 요구사항을 가장 단순하게 짜면 포인터 멤버 하나다. 이 포인터를 통해 `const` 객체에서도 IMU를 실제로 바꿀 수 있는지 실측해 본다.

```cpp title="shallow_const.cpp — const LegController가 IMU는 못 지킨다"
#include <iostream>

class ImuSensor {
public:
    void calibrate() { calibrated_ = true; }   // IMU를 재보정한다 -- 상태를 바꾼다
    bool calibrated() const { return calibrated_; }
private:
    bool calibrated_ = false;
};

class LegController {
public:
    explicit LegController(ImuSensor* imu) : imu_(imu) {}

    void meddle() const {          // const 멤버 함수 -- *this는 못 바꾼다는 약속
        imu_->calibrate();         // 그런데 imu_가 "가리키는" 대상은 *this가 아니다
    }

private:
    ImuSensor* imu_;   // 포인터 자체는 const가 아니다 -- LegController가 const라도 이건 안 막힌다
};

void inspect(const LegController& leg) {
    leg.meddle();   // leg는 const인데 이 호출이 컴파일된다
}

int main() {
    ImuSensor imu;
    LegController leg(&imu);
    inspect(leg);
    std::cout << std::boolalpha << imu.calibrated() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra shallow_const.cpp -o shallow_const
$ ./shallow_const
true
```

(g++ 13.3 실측.) `inspect`는 `leg`를 `const LegController&`로 받았고, `meddle()`도 `const` 멤버 함수다. 그런데도 `imu.calibrated()`는 `true`다 — IMU가 실제로 재보정됐다. **`const`는 `*this`가 가진 값(포인터 값 자신)만 지킨다. 포인터가 "가리키는" 대상은 `*this`의 일부가 아니다.** 컴파일러 입장에서는 `imu_`라는 주소값이 `meddle()` 안에서 안 바뀌었으니 약속을 지킨 것이다. 이걸 **얕은 const(shallow const)**라 부른다 — `const`가 포인터까지만 닿고 그 너머로 전파(propagate)되지 않는다는 뜻이다.

`LegController`가 IMU를 절대 바꾸지 않을 의도라면, 그 의도를 컴파일러가 강제하게 만드는 방법은 하나다 — 포인터 자체를 가리키는 대상까지 `const`로 선언하는 것.

```cpp title="shallow_const_fixed.cpp — const ImuSensor* 로 바꾸면 컴파일러가 잡아 준다"
class ImuSensor {
public:
    void calibrate() { calibrated_ = true; }
    bool calibrated() const { return calibrated_; }
private:
    bool calibrated_ = false;
};

class LegController {
public:
    explicit LegController(const ImuSensor* imu) : imu_(imu) {}   // 포인터 자체를 const로 선언했다

    void meddle() const {
        imu_->calibrate();   // 이제 이 줄이 컴파일 에러다
    }

private:
    const ImuSensor* imu_;
};
```

```console
$ g++ -std=c++20 -Wall -Wextra -c shallow_const_fixed.cpp
shallow_const_fixed.cpp: In member function 'void LegController::meddle() const':
shallow_const_fixed.cpp:16:24: error: passing 'const ImuSensor' as 'this' argument discards qualifiers [-fpermissive]
   16 |         imu_->calibrate();   // 이제 이 줄이 컴파일 에러다
      |         ~~~~~~~~~~~~~~~^~
shallow_const_fixed.cpp:5:10: note:   in call to 'void ImuSensor::calibrate()'
```

(g++ 13.3 실측.) 이제 `imu_->calibrate()`가 컴파일 시점에 걸린다. `const ImuSensor*`는 "이 포인터를 통해서는 대상을 읽기만 한다"는 약속이고, `calibrate()`는 그 약속을 어기는 non-const 메서드라 호출 자체가 막힌다. **포인터·레퍼런스 멤버로 뭔가를 참조할 때는, 그 대상을 바꿀 생각이 없으면 포인터/레퍼런스 자체를 처음부터 `const`로 선언해라.** `LegController`는 뒤에서 정확히 이 형태(`const ImuSensor&`)로 IMU를 참조한다. 이 함정이 놀라운 이유는 하나다 — `const LegController&`를 받는 코드를 읽는 사람은 직관적으로 "이 함수는 아무것도 못 바꾼다"고 믿지만, 포인터/레퍼런스 멤버가 있으면 그 직관이 깨진다.

### const 하나가 빠지면 위로 전부 막힌다

const 정확성이 "나중에 덧붙이기 어려운" 이유는 전파 방향 때문이다. 어떤 클래스의 멤버 함수 하나가 `const`를 빠뜨리면, 그 클래스를 참조하는 모든 상위 코드의 `const` 메서드가 막힌다. 두 단계짜리 호출 사슬로 확인한다.

```cpp title="const_chain_broken.cpp — Filter::smoothed()가 const를 안 붙였다"
#include <iostream>

struct Orientation { double roll, pitch, yaw; };

class Filter {
public:
    Orientation smoothed() { return last_; }   // const를 깜빡했다
private:
    Orientation last_{0.0, 0.0, 0.0};
};

class ImuSensor {
public:
    Orientation orientation() const {
        return filter_.smoothed();   // *this가 const라 filter_도 const Filter로 취급된다
    }
private:
    Filter filter_;
};

class LegController {
public:
    explicit LegController(const ImuSensor* imu) : imu_(imu) {}
    Orientation body_orientation() const {
        return imu_->orientation();
    }
private:
    const ImuSensor* imu_;   // 읽기 전용 참조 -- 소유하지 않는다
};
```

```console
$ g++ -std=c++20 -Wall -Wextra -c const_chain_broken.cpp
const_chain_broken.cpp: In member function 'Orientation ImuSensor::orientation() const':
const_chain_broken.cpp:15:32: error: passing 'const Filter' as 'this' argument discards qualifiers [-fpermissive]
   15 |         return filter_.smoothed();   // *this가 const라 filter_도 const Filter로 취급된다
      |                ~~~~~~~~~~~~~~~~^~
const_chain_broken.cpp:7:17: note:   in call to 'Orientation Filter::smoothed()'
```

(g++ 13.3 실측.) `Filter::smoothed()`에 `const`가 없다는 사실 하나가 `ImuSensor::orientation() const`를 막는다 — `orientation()`이 `const`이므로 그 안의 `filter_`는 `const Filter`로 취급되고, `const Filter`는 non-const 메서드를 못 부른다. `LegController::body_orientation()`은 한 줄도 안 건드렸는데 이 사슬의 끝에서 컴파일이 막힌다. 고치는 방법은 하나뿐이다 — `Filter::smoothed()`에 `const`를 붙인다.

```cpp title="const_chain_fixed.cpp — smoothed()에 const 하나를 더했다"
Orientation smoothed() const { return last_; }   // 이 한 줄만 바뀌었다
```

```console
$ g++ -std=c++20 -Wall -Wextra const_chain_fixed.cpp -o const_chain_fixed
$ ./const_chain_fixed
0 0 0
```

(g++ 13.3 실측.) 이 실측이 보여주는 건 버그가 아니라 **설계 결정의 성격**이다. `Filter`를 처음 짤 때 `const`를 붙이는 건 한 글자 추가지만, 이미 여러 곳에서 쓰이는 상태에서 뒤늦게 붙이려면 호출하는 모든 곳의 시그니처를 다시 점검해야 하고, 실제로 멤버를 바꾸는 코드가 섞여 있었다면 그것부터 고쳐야 한다. **const는 아래에서 위로 전파되고, 전파가 막히는 지점을 찾아 고치는 비용은 클래스 계층이 깊을수록 커진다.** 그래서 원칙은 "나중에 정리하지 말고 처음부터 붙인다"다.

### mutable: 논리적 상수성의 예외

`const` 멤버 함수가 "관찰 가능한 상태"를 안 바꾼다는 약속이라면, 겉으로 드러나지 않는 내부 통계(호출 횟수, 캐시)까지 그 약속에 묶일 필요는 없다. 이럴 때 멤버를 `mutable`로 선언하면 `const` 함수 안에서도 그 멤버만은 바꿀 수 있다.

```cpp title="mutable_demo.cpp — call_count_는 논리적 상수성 밖에 있다"
#include <iostream>

class JointLimit {
public:
    JointLimit(double min_rad, double max_rad) : min_(min_rad), max_(max_rad) {}

    double clamp(double angle) const {
        ++call_count_;   // mutable 덕분에 const 함수 안에서도 값을 바꿀 수 있다
        if (angle < min_) return min_;
        if (angle > max_) return max_;
        return angle;
    }

    long call_count() const { return call_count_; }

private:
    double min_;
    double max_;
    mutable long call_count_ = 0;   // 관찰 가능한 상태(min_/max_)에는 포함되지 않는 통계
};

int main() {
    const JointLimit femur(-1.57, 1.57);   // const 객체다 -- clamp()만 부를 수 있다
    femur.clamp(3.0);
    femur.clamp(-3.0);
    femur.clamp(0.2);
    std::cout << "call_count = " << femur.call_count() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra mutable_demo.cpp -o mutable_demo
$ ./mutable_demo
call_count = 3
```

(g++ 13.3 실측.) `femur`는 `const` 객체이므로 `clamp()`만 호출할 수 있는데도 `call_count_`는 3까지 늘었다 — `mutable`이 이 멤버 하나만 `const`의 감시 범위 밖에 뒀기 때문이다. `mutable`이 없었다면 `++call_count_;`는 [3.1](#/classes)의 "`read-only object`" 에러 그대로 걸린다. 쓸 자리는 딱 하나로 좁다 — **호출자가 관찰할 수 있는 어떤 값도 이 멤버에 의존하지 않을 때**뿐이다(캐시, 락, 통계 카운터). `min_`·`max_`를 `mutable`로 만드는 건 잘못된 사용이다 — `clamp()`의 결과 자체를 바꾸는 관찰 가능한 상태이기 때문이다.

## 인터페이스 최소화: 이 멤버가 정말 public이어야 하는가

[3.1](#/classes)의 캡슐화 원칙 — private는 값을 바꾸는 통로를 좁혀서 검사를 심는 수단이다 — 은 멤버 함수에도 그대로 적용된다. **public 메서드 하나하나가 불변식을 우회할 수 있는 통로다.** 디버깅 편의로 늘어난 public 표면이 실제로 무엇을 여는지 본다.

```cpp title="interface_bloat.cpp — 편해서 하나씩 늘린 public 멤버가 clamp를 무력화한다"
#include <array>

class ActuatorDriverBloated {
public:
    void set_target(int idx, double angle) { angles_[idx] = angle; }
    double current_angle(int idx) const { return angles_[idx]; }

    // 디버깅하다가 편해서 하나씩 늘어난 public 멤버들 -- 전부 내부 구현 디테일이다
    std::array<double, 3>& raw_angles() { return angles_; }        // 배열 전체를 그대로 노출
    void force_set_all(std::array<double, 3> a) { angles_ = a; }   // clamp를 건너뛸 통로
    bool debug_flag = false;                                       // 아예 멤버 변수가 public

private:
    std::array<double, 3> angles_{};
};

int main() {
    ActuatorDriverBloated drv;
    drv.raw_angles()[0] = 9999.0;   // set_target의 clamp를 완전히 우회한다
    drv.debug_flag = true;          // 누구든 아무 때나 뒤집을 수 있다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra interface_bloat.cpp -o interface_bloat
$ ./interface_bloat
```

(g++ 13.3 실측 — 경고 없이 컴파일되고 조용히 실행된다.) `raw_angles()`는 "배열을 잠깐 들여다보려고" 추가됐을 뿐인데, 반환 타입이 `std::array<double, 3>&`라 호출자가 그 참조로 `angles_`를 직접 덮어쓸 수 있다 — `set_target`이 clamp를 강제하려던 의도가 이 통로 하나로 무너진다. `debug_flag`는 처음부터 검사가 없는 public 멤버 변수다. 이 셋 중 어느 것도 클래스 바깥이 정말 필요로 하는 기능이 아니다 — 전부 "구현하다 편해서" 남은 통로다. **새 public 멤버를 추가하기 전에 "이걸 밖에서 정말 불러야 하는가"를 매번 물어라.** 답이 "테스트·디버깅에서만"이면 friend 테스트 클래스나 별도 진단 함수로 빼야 할 신호다.

## 결정 체크리스트를 LegController에 순서대로 적용한다

이제 요구사항 넷을 [3.7 결정 체크리스트](#/composition)의 순서로 하나씩 처리하면서 `LegController`를 완성한다.

### ① 값 타입인가 다형 타입인가

[3.6](#/operator-overloading)의 `Vector2`처럼 `+`, `==`로 다뤄야 하는 값 타입인가, 아니면 [3.7](#/composition) 끝에서 본 것처럼 베이스 포인터로 여러 구체 타입을 동일하게 다뤄야 하는 다형 타입인가. `LegController`는 후자다 — 6개 다리를 `vector` 하나로 순회한다는 요구사항 자체가 다형성을 요구한다. 그래서 `operator==`도, 값처럼 복사해서 비교하는 코드도 두지 않는다 — 이 타입은 "값"이 아니라 실물 다리 하나에 대응하는 **식별자를 가진 개체(entity)**다.

```cpp title="leg_controller_base.cpp — 순수 가상함수로 인터페이스만 정의한다"
#include <cstddef>

class LegControllerBase {
public:
    virtual ~LegControllerBase() = default;   // 다형 소멸에 필수 -- 이유는 3.4에서 다룬다
    virtual void update(double dt) = 0;                     // 매 제어 주기마다 호출
    virtual double joint_angle(std::size_t idx) const = 0;  // 텔레메트리용 읽기 전용 접근자
};
```

순수 가상함수·NVI 패턴의 세부는 [3.5](#/abstract-interfaces)에서, 가상 소멸자가 필수인 이유는 [3.4](#/virtual-vtable)에서 다룬다. 지금은 "다형적으로 다뤄야 하니 순수 가상 인터페이스가 필요하다"는 결정만 확정한다.

### ② 상속인가 컴포지션인가

[3.7의 리스코프 치환 질문](#/composition)을 `LegController`가 갖는 두 관계 각각에 적용한다.

- **`LegController`와 `LegControllerBase`**: `LegController`를 `LegControllerBase&`가 쓰이는 모든 자리(순회 벡터, `update()` 호출)에 넣어도 옳게 동작하는가? 그렇다 — 이게 ①에서 상속을 쓰기로 한 이유다. is-a가 성립하니 `public` 상속이 맞다.
- **`LegController`와 `ImuSensor`**: `LegController`를 `ImuSensor&`가 필요한 자리에 대신 넣을 이유가 있는가? 없다. IMU는 다리의 한 종류가 아니라 다리가 참조하는 부품이다 — 명백한 has-a, 컴포지션이다.

### ③ 복사 가능해야 하는가

요구사항이 이미 답을 줬다 — 복사되면 안 된다. [2.8 Rule of 0/3/5](#/rule-of-five)를 적용하면 `= delete`를 손으로 쓸 필요조차 없다. `LegController`는 `unique_ptr` 멤버를 갖게 되고, 그 복사 생성자가 [2.9](#/unique-ptr)에서 이미 `delete`돼 있으므로 컴파일러가 `LegController`의 복사도 자동으로 지운다. **아무것도 안 쓰는 것이 이 결정을 반영하는 가장 정확한 방법이다.** 검증은 `static_assert`로 한다.

### ④ 소유 관계는

`LegController`가 갖는 세 종류의 부품에 [2.2](#/pointers)·[2.3](#/references)·[2.9](#/unique-ptr)의 기준을 각각 적용한다.

| 부품 | 관계 | 선택 | 이유 |
|---|---|---|---|
| `JointLimit` 3개 | 소유, 값 타입 | `std::array<JointLimit, 3>` 값 멤버 | 작고 다형적이지 않다 — 포인터·스마트 포인터가 오히려 과하다 |
| `ImuSensor` | 참조만, 소유 안 함 | `const ImuSensor&` | 몸체가 소유하고 6개 다리가 공유한다 — 재바인딩이 필요 없으니 레퍼런스로 충분하다(2.3) |
| `ActuatorDriver` | 독점 소유, 다형 타입 | `std::unique_ptr<ActuatorDriver>` | 실물/시뮬레이션 구현이 갈리고(다형), 다리 하나가 배타적으로 소유한다(2.9) |

**"소유하는가"와 "다형적인가"라는 두 축을 따로 물으면 포인터 종류가 저절로 정해진다.** 소유 안 하면 레퍼런스, 소유+값 타입이면 값 멤버, 소유+다형 타입이면 `unique_ptr`. `shared_ptr`는 이 표 어디에도 없다 — 누구와도 소유권을 나눌 이유가 없기 때문이다.

## 완성된 LegController

네 결정을 전부 반영해 조립한다.

```cpp title="leg_controller.cpp — 결정 4개가 그대로 코드가 됐다"
#include <array>
#include <cstddef>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <type_traits>
#include <vector>

// --- ① 값 타입인가 다형 타입인가: 다형 타입이라 인터페이스를 따로 둔다 ---
class LegControllerBase {
public:
    virtual ~LegControllerBase() = default;
    virtual void update(double dt) = 0;
    virtual double joint_angle(std::size_t idx) const = 0;
};

// --- 3.1 JointLimit 그대로: 불변식(min_ < max_)을 생성자가 강제한다 ---
class JointLimit {
public:
    JointLimit(double min_rad, double max_rad)
        : min_(validate(min_rad, max_rad)), max_(max_rad) {}
    double clamp(double angle) const {
        if (angle < min_) return min_;
        if (angle > max_) return max_;
        return angle;
    }
private:
    static double validate(double lo, double hi) {
        if (lo >= hi) throw std::invalid_argument("JointLimit: min must be less than max");
        return lo;
    }
    double min_;
    double max_;
};

// --- IMU: 앞서 확인한 교훈대로 처음부터 const-correct하게 설계했다 ---
struct Orientation { double roll, pitch, yaw; };

class ImuSensor {
public:
    Orientation orientation() const { return orientation_; }
    void update(Orientation o) { orientation_ = o; }   // IMU 자신만 값을 갱신한다
private:
    Orientation orientation_{};
};

// --- ④ 독점 소유 + 다형 타입 -- unique_ptr로 LegController가 갖는다 ---
class ActuatorDriver {
public:
    virtual ~ActuatorDriver() = default;
    virtual void set_target(std::size_t idx, double angle) = 0;
    virtual double current_angle(std::size_t idx) const = 0;
};

class SimActuatorDriver : public ActuatorDriver {
public:
    void set_target(std::size_t idx, double angle) override { angles_.at(idx) = angle; }
    double current_angle(std::size_t idx) const override { return angles_.at(idx); }
private:
    std::array<double, 3> angles_{};
};

// --- 결정 4개를 전부 반영한 최종 클래스 ---
class LegController : public LegControllerBase {   // ②: is-a, public 상속
public:
    LegController(std::array<JointLimit, 3> limits,
                  const ImuSensor& imu,
                  std::unique_ptr<ActuatorDriver> actuator)
        : limits_(std::move(limits)), imu_(imu), actuator_(std::move(actuator)) {}

    // ③: 복사 생성자/대입을 손으로 delete하지 않았다 -- actuator_가 unique_ptr이라
    // Rule of Zero(2.8)에 따라 컴파일러가 이미 자동으로 delete했다.

    void update(double dt) override {
        (void)dt;
        const double tilt_comp = imu_.orientation().pitch * 0.1;   // 참조만 하는 IMU를 읽는다
        for (std::size_t i = 0; i < 3; ++i) {
            const double raw = target_[i] + (i == 1 ? tilt_comp : 0.0);
            actuator_->set_target(i, limits_[i].clamp(raw));   // 항상 clamp를 거쳐서 나간다
        }
    }

    void set_target(std::array<double, 3> target) { target_ = target; }

    double joint_angle(std::size_t idx) const override {
        return actuator_->current_angle(idx);
    }

private:
    std::array<JointLimit, 3> limits_;           // ④: 소유, 값 타입
    const ImuSensor& imu_;                       // ④: 참조만, 레퍼런스
    std::unique_ptr<ActuatorDriver> actuator_;    // ④: 소유, 다형 타입
    std::array<double, 3> target_{};
};

static_assert(!std::is_copy_constructible_v<LegController>,
              "LegController는 복사되면 안 된다 -- 실물 다리 하나에 컨트롤러가 둘이면 안 된다");
static_assert(!std::is_copy_assignable_v<LegController>,
              "복사 대입도 마찬가지로 막혀야 한다");
static_assert(std::is_move_constructible_v<LegController>,
              "이동은 여전히 가능하다 -- unique_ptr는 이동까지 막지 않는다");
static_assert(std::has_virtual_destructor_v<LegControllerBase>,
              "다형적으로 unique_ptr<LegControllerBase>로 소멸시키려면 가상 소멸자가 필수다");

int main() {
    ImuSensor body_imu;
    body_imu.update(Orientation{0.0, 0.05, 0.0});   // 몸체가 살짝 앞으로 기울었다고 가정

    std::vector<std::unique_ptr<LegControllerBase>> legs;   // ①: 다형 벡터로 순회한다
    for (int i = 0; i < 2; ++i) {
        std::array<JointLimit, 3> limits{
            JointLimit(-0.78, 0.78),   // coxa
            JointLimit(-1.57, 1.57),   // femur
            JointLimit(-2.09, 0.0),    // tibia
        };
        auto leg = std::make_unique<LegController>(
            std::move(limits), body_imu, std::make_unique<SimActuatorDriver>());
        leg->set_target({0.1, 0.5, -1.0});
        legs.push_back(std::move(leg));
    }

    for (auto& leg : legs) {
        leg->update(0.01);   // 구체 타입을 모른 채 인터페이스로만 호출한다
    }

    for (std::size_t li = 0; li < legs.size(); ++li) {
        std::cout << "leg[" << li << "] femur = " << legs[li]->joint_angle(1) << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra leg_controller.cpp -o leg_controller
$ ./leg_controller
leg[0] femur = 0.505
leg[1] femur = 0.505
```

(g++ 13.3 / Linux x86-64 실측 — 경고 없이 컴파일된다.) `femur = 0.505`는 `set_target`의 `0.5`에 IMU pitch(`0.05`) × 이득(`0.1`)을 더한 값이다 — 참조만 하는 `imu_`를 실제로 읽어 계산에 반영했다는 뜻이다. 네 `static_assert`가 전부 컴파일 타임에 통과했다 — 복사 금지, 이동 허용, 가상 소멸자 존재가 코드에 못박혔다. 이 못이 실제로 작동하는지 복사를 강행해서 확인한다.

```cpp title="copy_attempt.cpp — 복사를 시도하면 이렇게 막힌다"
LegController a(std::make_unique<ActuatorDriver_구현체>());
LegController b = a;   // 복사 시도
```

```console
$ g++ -std=c++20 -Wall -Wextra -c copy_attempt.cpp
copy_attempt.cpp:14:23: error: use of deleted function 'LegController::LegController(const LegController&)'
   14 |     LegController b = a;   // 복사 시도
      |                       ^
copy_attempt.cpp:6:7: note: 'LegController::LegController(const LegController&)' is implicitly deleted because the default definition would be ill-formed:
copy_attempt.cpp:6:7: error: use of deleted function 'std::unique_ptr<...>::unique_ptr(const std::unique_ptr<...>&)'
```

(g++ 13.3 실측.) 에러 메시지의 "`implicitly deleted because the default definition would be ill-formed`"가 정확히 [2.8 Rule of 0/3/5](#/rule-of-five)의 도미노 규칙을 가리킨다 — `LegController`는 복사 생성자를 손으로 `delete`한 적이 없는데도, `actuator_`(`unique_ptr`)의 복사 생성자가 이미 없어서 컴파일러가 `LegController`의 복사 생성자도 자동으로 없앴다. **"복사되면 안 된다"는 요구사항을 만족시키려고 코드를 추가한 게 아니라, 소유 관계를 정확히 표현했더니 그 결정이 저절로 딸려 왔다.** 이게 Rule of Zero가 실전에서 갖는 진짜 무게다.

## 로봇 도메인: 이 클래스 자체가 목적지다

이 절의 다른 절들과 달리 별도의 "로보틱스 연결" 문단이 필요 없다 — `LegController`는 처음부터 헥사포드 다리 하나를 제어하는 클래스로 설계됐다. [9.5 역기구학](#/inverse-kinematics)이 계산한 목표 관절각을 `set_target()`으로 받고, [10.9 ros2_control과 hardware_interface](#/ros2-control)의 제어 루프가 매 주기 `update()`를 부르는 그림이 이 클래스가 실제로 앉을 자리다. `ActuatorDriver`를 `SimActuatorDriver` 대신 실물 서보 드라이버로 갈아 끼워도 `LegController`의 코드는 한 줄도 안 바뀐다 — ①에서 다형 타입으로 결정한 값이 정확히 이 교체 가능성을 위한 것이었다.

::: interview 클래스를 설계할 때 어떤 순서로 결정을 내리나
답변 뼈대: ① **값 타입인가 다형 타입인가**를 가장 먼저 묻는다 — 값 타입이면 연산자 오버로딩·자유로운 복사를, 다형 타입이면 순수 가상 인터페이스·제한된 복사를 검토하게 된다. ② **관계마다 리스코프 치환을 따로 적용**한다 — 한 클래스가 여러 부품을 가질 때 관계마다 상속/컴포지션이 다를 수 있다(`LegController`는 `LegControllerBase`와는 is-a, `ImuSensor`와는 has-a). ③ **복사 가능 여부는 요구사항에서 나온다** — 실물 자원을 대변하는 타입은 대개 복사 금지이고, Rule of Zero를 따르면 코드 없이 자동으로 반영되는 경우가 많다. ④ **소유 관계는 "소유하는가 × 다형적인가"의 교차표로 정한다** — 참조만 하면 레퍼런스, 소유+값 타입이면 값 멤버, 소유+다형 타입이면 `unique_ptr`. 이 순서를 지키면 완성된 클래스의 `public` 표면이 최소한으로 좁혀진다는 것까지 답하면 완결된다.
:::

## 요약

- **const 정확성**은 멤버 함수마다 상태 변경 여부를 정확히 표시하는 습관이다. `const`는 **얕게** 적용된다 — 포인터/레퍼런스 멤버가 가리키는 대상까지는 지키지 않는다(실측: `const LegController&`인데도 `imu_->calibrate()`가 통과). 대상을 바꿀 생각이 없으면 포인터·레퍼런스 자체를 `const`로 선언해야 컴파일러가 잡아 준다.
- const는 아래에서 위로 전파된다. 밑단 클래스의 메서드 하나에 `const`가 빠지면 그 위 모든 호출 사슬의 `const` 메서드가 막힌다(실측: `Filter::smoothed()`의 `const` 누락이 `LegController::body_orientation()`까지 전파). 그래서 나중에 덧붙이기보다 처음부터 붙이는 게 싸다.
- `mutable`은 관찰 가능한 상태에 포함되지 않는 멤버(캐시, 통계)에만 쓴다 — `const` 함수 안에서도 그 멤버만 예외적으로 바뀐다(실측: `call_count = 3`).
- **인터페이스 최소화**: public 멤버 하나하나가 불변식을 우회할 수 있는 통로다. "디버깅하다 편해서" 남은 참조 반환·세터가 clamp 같은 검사를 통째로 무력화할 수 있다(실측: `raw_angles()[0] = 9999.0`이 경고 없이 통과).
- 설계 결정은 순서가 있다 — ① 값 타입 vs 다형 타입(3.6/3.4) → ② 관계별 리스코프 치환으로 상속/컴포지션(3.7) → ③ 복사 가능 여부(2.8 Rule of Zero) → ④ 소유 관계를 "소유+다형" 교차표로(2.9). `LegController`는 이 순서로 상속 1개(`LegControllerBase`), 컴포지션 1개(`ImuSensor`, 레퍼런스), 독점 소유 1개(`ActuatorDriver`, `unique_ptr`)를 얻었다.
- 복사 금지는 `= delete`를 손으로 쓰지 않아도 된다 — `unique_ptr` 멤버가 있으면 Rule of Zero에 따라 컴파일러가 이미 복사를 지운다(실측: `implicitly deleted because the default definition would be ill-formed`). `static_assert`로 그 사실을 코드에 못박아라.

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. `shallow_const.cpp`에서 `meddle()`이 `const` 멤버 함수인데도 `imu_->calibrate()`가 컴파일되는 이유를 "얕은 const"라는 용어를 써서 설명하라. `imu_`의 선언을 어떻게 바꾸면 이 호출이 컴파일 에러가 되는가?
2. `LegController`가 `ImuSensor`는 컴포지션(레퍼런스)으로, `LegControllerBase`는 상속으로 연결한 이유를 리스코프 치환 원칙으로 각각 설명하라.
3. `LegController`에 새 멤버 `std::shared_ptr<ActuatorDriver> actuator_;`를 `unique_ptr` 대신 썼다고 하자. `static_assert(!std::is_copy_constructible_v<LegController>)`가 여전히 통과하는지 예측하고, 그 이유를 `shared_ptr`와 `unique_ptr`의 복사 가능 여부 차이로 설명하라.
4. (실습) `MotorDriver`라는 새 클래스를 이 절의 체크리스트(①~④) 순서로 처음부터 설계하라 — 모터 하나의 목표 RPM 한계를 강제하고, 온도 센서를 참조하며, 다형적으로(여러 모터 종류) 다뤄질 수 있고, 복사되면 안 된다는 요구사항을 스스로 정하고 코드로 반영하라. `g++ -std=c++20 -Wall -Wextra`로 경고 없이 컴파일되는지 확인하라.
5. (실습) 4번의 `MotorDriver`에 `static_assert`로 복사 불가·이동 가능·(다형 베이스가 있다면) 가상 소멸자 존재를 코드로 못박아라. 그중 하나를 일부러 깨뜨려(예: 온도 센서를 레퍼런스 대신 값으로 복사해 넣기) 어떤 `static_assert`가 실패하는지 직접 확인하라.
:::

::: answer 해설
1. `const`는 `*this`가 소유한 포인터 값 자체만 지킨다. `imu_`가 가리키는 `ImuSensor`는 `LegController`가 소유한 값이 아니므로 보호 범위 밖이다 — 이게 얕은 const다. `imu_`를 `const ImuSensor*`(또는 `&`)로 선언하면 `calibrate()` 호출이 non-const 메서드 호출이 되어 컴파일 에러가 난다.
2. `ImuSensor`를 `LegController` 대신 넣어야 하는 자리가 없으므로(계약을 흉내 낼 이유가 없다) has-a다. 반대로 `LegControllerBase&`가 필요한 모든 자리에 `LegController`를 넣어도 옳게 동작하므로(계약을 전부 지킨다) is-a이고 상속이 맞다.
3. 통과하지 않는다 — `shared_ptr`의 복사 생성자는 `delete`되지 않고 참조 카운트를 늘리며 정상 동작한다([2.10](#/shared-ptr)). "복사되면 안 된다"는 요구사항을 지키려면 이번엔 복사 생성자·대입을 손으로 `= delete`해야 한다 — Rule of Zero가 대신해 주지 않는다.
4. `MotorDriverBase`(순수 가상 `set_rpm`/`current_rpm`), `RpmLimit`(생성자 검증)은 값 멤버, `TemperatureSensor`는 `const&`, 실제 구동부는 `unique_ptr<MotorHardware>`로 짜면 `LegController`와 같은 구조가 나온다.
5. `TemperatureSensor`를 값으로 복사해 저장하면 복사 자체가 막히지 않는다 — 값 멤버가 전부 복사 가능하면 클래스도 복사 가능해지기 때문이다. 이게 "소유 관계를 잘못 정하면 복사 금지 의도가 조용히 깨진다"는 이 절의 핵심을 실습으로 보여준다.
:::

이 절의 `LegController`는 전부 직접 타이핑해라. 특히 `shallow_const.cpp`와 `shallow_const_fixed.cpp`를 나란히 두고 포인터 선언에 `const`를 넣었다 뺐다 하며 어디서 컴파일이 막히는지 직접 보고, `copy_attempt.cpp`는 지우지 말고 그대로 컴파일해 에러 메시지 전문을 읽어라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [4.1 함수 템플릿](#/function-templates) — Part III은 여기서 끝난다. Part IV는 관점을 완전히 바꾼다 — `LegController` 하나를 손으로 잘 설계했다면, 이제 같은 코드를 타입마다 다시 쓰지 않고 컴파일러가 대신 찍어내게 만드는 법을 본다.
