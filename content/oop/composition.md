# 3.7 컴포지션 vs 상속

::: lead
[3.3 상속: is-a의 비용](#/inheritance)에서 상속이 결합도가 가장 강한 관계라는 것을 실측으로 봤다. 객체 슬라이싱, protected가 만드는 암묵적 계약, 다중 상속의 다이아몬드 — 전부 "베이스와 파생이 하나의 타입 계층으로 물리적으로 얽혀 있다"는 사실에서 나오는 비용이다. 이 절은 그 비용을 아예 지지 않는 대안, 즉 클래스를 멤버 변수로 갖는 컴포지션(composition)을 다룬다. 언제 상속이 정말 필요하고 언제 컴포지션으로 충분한지, 그리고 컴포지션이 공짜가 아니라는 사실까지 같이 본다.
:::

## protected 결합을 다시 본다: 상속 없이 같은 기능을 짠다

3.3의 `protected_after.cpp`는 `Sensor`가 저장 단위를 센티미터에서 미터로 바꾸자 `LidarSensor::range_in_meters()`가 경고 없이 틀린 값을 냈다. 해법은 데이터를 `private`로 감추고 `protected` 접근자 하나만 내주는 것이었다. 이 구조를 상속 없이, 멤버 변수로 다시 짜 본다.

```cpp title="inherit_side.cpp — 상속 버전 (3.3의 protected 접근자 패턴)"
#include <iostream>

class Sensor {
protected:
    double range_meters() const { return raw_range_meters_; }
private:
    double raw_range_meters_ = 2.5;
};

class LidarSensor : public Sensor {
public:
    double range_in_meters() const { return range_meters(); }   // protected 접근자를 통해서만 접근
};

int main() {
    LidarSensor lidar;
    std::cout << "range = " << lidar.range_in_meters() << " m\n";
    return 0;
}
```

```cpp title="compose_side.cpp — 컴포지션 버전, 상속 자체가 없다"
#include <iostream>

class Sensor {
public:
    double range_meters() const { return raw_range_meters_; }   // public이면 충분하다 -- protected가 필요 없다
private:
    double raw_range_meters_ = 2.5;
};

class LidarSensor {
public:
    double range_in_meters() const { return sensor_.range_meters(); }   // 위임 -- 상속이 아니라 호출
private:
    Sensor sensor_;   // has-a
};

int main() {
    LidarSensor lidar;
    std::cout << "range = " << lidar.range_in_meters() << " m\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra inherit_side.cpp -o inherit_side && ./inherit_side
range = 2.5 m
$ g++ -std=c++20 -Wall -Wextra compose_side.cpp -o compose_side && ./compose_side
range = 2.5 m
```

(g++ 13.3 / Linux x86-64 실측.) 결과는 똑같다. 그런데 두 버전의 접근 제어 난이도가 다르다. 상속 버전은 `range_meters()`를 `protected`로 뚫어야 `LidarSensor`가 부를 수 있다 — `Sensor`는 "내 파생 클래스가 누구든 이 메서드는 열어 준다"는 계층 전체와의 약속을 진다. 컴포지션 버전은 `range_meters()`가 그냥 `public`이다. `LidarSensor`는 `Sensor`의 계층에 속하는 게 아니라 `Sensor` **객체 하나를 갖고 그 public 인터페이스를 호출**할 뿐이다. `protected`라는 접근 지정자 자체가 필요 없어진다 — 상속 관계가 없으니 "베이스와 파생 사이의 특별한 접근 권한"도 애초에 성립할 자리가 없다.

이 차이가 이 절의 핵심이다. **상속은 "관계"를 만들고, 컴포지션은 "소유"를 만든다.** 관계는 계층 전체에 영향을 주고, 소유는 그 객체 하나로 끝난다.

## is-a vs has-a: 리스코프 치환 원칙으로 가른다

"이 관계를 상속으로 짤까, 컴포지션으로 짤까"는 감이 아니라 하나의 질문으로 판단할 수 있다. **`Derived`의 객체를 어디서든 `Base`의 객체 대신 넣어도 프로그램이 여전히 옳게 동작하는가?** 이걸 만족하는 관계만 진짜 is-a다. 1988년 바바라 리스코프가 정식화한 이 조건을 **리스코프 치환 원칙(Liskov Substitution Principle, LSP)**이라 부른다.

말로는 추상적이니 어긴 사례를 직접 컴파일해서 본다. `Robot`은 `move(double)`이라는 순수 가상함수로 "거리만큼 이동한다"는 계약을 건다. `WheeledRobot`은 이 계약을 지킨다. 문제는 `FixedTurret`이다 — 이름은 상속 문법상 `Robot`의 한 종류이지만, 고정된 거치대에 달려 있어 물리적으로 이동이 불가능하다.

```cpp title="lsp_violation.cpp — 상속 문법은 통과하지만 계약을 못 지키는 클래스"
#include <iostream>
#include <stdexcept>
#include <vector>
#include <memory>

class Robot {
public:
    virtual ~Robot() = default;
    virtual void move(double meters) = 0;
};

class WheeledRobot : public Robot {
public:
    void move(double meters) override {
        position_ += meters;
        std::cout << "WheeledRobot: " << meters << "m 이동, position=" << position_ << "\n";
    }
private:
    double position_ = 0.0;
};

// 고정 거치대에 달린 터렛 -- "Robot의 한 종류"로 선언은 했지만 실제로 움직이지 못한다
class FixedTurret : public Robot {
public:
    void move(double) override {
        throw std::logic_error("FixedTurret은 이동할 수 없다");   // is-a 계약을 못 지킨다
    }
};

void patrol(Robot& r) {
    r.move(1.0);   // Robot이라면 당연히 되리라 믿고 호출한다
}

int main() {
    std::vector<std::unique_ptr<Robot>> fleet;
    fleet.push_back(std::make_unique<WheeledRobot>());
    fleet.push_back(std::make_unique<FixedTurret>());

    for (auto& r : fleet) {
        try {
            patrol(*r);
        } catch (const std::exception& e) {
            std::cout << "patrol 실패: " << e.what() << "\n";
        }
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lsp_violation.cpp -o lsp_violation && ./lsp_violation
WheeledRobot: 1m 이동, position=1
patrol 실패: FixedTurret은 이동할 수 없다
```

(g++ 13.3 실측.) 컴파일은 경고 없이 통과했다 — 문법상 `FixedTurret`은 완벽한 `Robot`이다. 그런데 `patrol()`은 "`Robot&`를 받으면 `move()`가 실제로 이동시킨다"는 암묵적 계약을 전제로 짜여 있고, `FixedTurret`은 그 계약을 예외로 깬다. `fleet`을 순회하는 코드는 자기가 지금 어떤 구체 타입을 다루는지 몰라야 하는데, 실제로는 "혹시 이게 `FixedTurret`이면 예외가 난다"는 걸 알고 있어야 안전하게 쓸 수 있다 — 이게 LSP 위반의 실질적 증상이다: 파생 타입이 늘어날 때마다 호출자가 그 파생 타입의 예외 사례를 하나씩 기억해야 한다.

`FixedTurret`은 애초에 `Robot`을 상속할 이유가 없었다. "터렛은 로봇의 한 종류"가 아니라 "터렛은 방향 조준 기능이 있다"는 게 진짜 관계이고, 필요하면 `Robot`이 `FixedTurret`을 부품으로 갖는(has-a) 쪽이 맞다.

::: note is-a 판단 질문
"명사로 봤을 때 하위 개념인가"가 아니라 "**행동 계약을 전부 만족하는가**"로 판단해라. `FixedTurret`은 명사로는 `Robot`의 하위 개념처럼 들리지만, `move()`라는 행동 계약은 못 지킨다. 반대로 이름은 전혀 안 닮았어도 인터페이스 계약을 전부 만족하면 is-a 후보가 된다.
:::

**컴포지션이 나은 경우**는 이것과 대칭이다 — 목적이 "진짜 서브타입"이 아니라 **다른 클래스의 기능 일부를 재사용**하는 것뿐일 때다. `LidarSensor`가 "거리를 저장하고 변환하는 로직"을 `Sensor`한테서 가져다 쓰고 싶은 것이지, `LidarSensor`의 객체를 `Sensor&`가 필요한 모든 자리에 대신 넣을 생각이 없다면 상속은 과하다.

## 컴포지션 구현: 멤버로 갖고, 위임한다

컴포지션은 문법이랄 게 따로 없다 — 그냥 멤버 변수다. `Robot`이 `Sensor`의 한 종류가 아니라 `Sensor` 여러 개를 부품으로 갖는 경우로 실제 로봇 예제를 짠다.

```cpp title="robot_composition.cpp — Robot이 LidarSensor·ImuSensor를 멤버로 갖는다"
#include <iostream>
#include <string>

class LidarSensor {
public:
    LidarSensor(std::string frame_id, int beam_count)
        : frame_id_(std::move(frame_id)), beam_count_(beam_count) {}
    std::string describe() const {
        return "Lidar(" + frame_id_ + ", beams=" + std::to_string(beam_count_) + ")";
    }
private:
    std::string frame_id_;
    int beam_count_;
};

class ImuSensor {
public:
    ImuSensor(std::string frame_id, int hz) : frame_id_(std::move(frame_id)), hz_(hz) {}
    std::string describe() const {
        return "Imu(" + frame_id_ + ", " + std::to_string(hz_) + "Hz)";
    }
private:
    std::string frame_id_;
    int hz_;
};

// Robot은 Sensor의 한 종류가 아니다 -- Sensor 여러 개를 부품으로 갖는다 (has-a)
class Robot {
public:
    Robot() : lidar_("lidar_front", 16), imu_("imu_chassis", 200) {}

    // 위임: Robot 자신의 인터페이스로 각 부품의 기능을 노출한다
    std::string lidar_status() const { return lidar_.describe(); }
    std::string imu_status() const { return imu_.describe(); }

private:
    LidarSensor lidar_;
    ImuSensor imu_;
};

int main() {
    Robot robot;
    std::cout << robot.lidar_status() << "\n";
    std::cout << robot.imu_status() << "\n";
    std::cout << "sizeof(Robot) = " << sizeof(Robot) << "\n";
    std::cout << "sizeof(LidarSensor) = " << sizeof(LidarSensor) << "\n";
    std::cout << "sizeof(ImuSensor) = " << sizeof(ImuSensor) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra robot_composition.cpp -o robot_composition
$ ./robot_composition
Lidar(lidar_front, beams=16)
Imu(imu_chassis, 200Hz)
sizeof(Robot) = 80
sizeof(LidarSensor) = 40
sizeof(ImuSensor) = 40
```

(g++ 13.3 실측.) `sizeof(Robot)` = 80은 정확히 `sizeof(LidarSensor)`(40) + `sizeof(ImuSensor)`(40)이다 — vtable 포인터도, 공유 베이스 서브오브젝트도 없다. `Robot`은 그냥 두 부품을 이어붙인 상자다. `lidar_status()`와 `imu_status()`가 **위임(delegation)** 메서드다 — 호출을 그대로 부품 객체의 메서드 호출로 전달할 뿐, `Robot` 자신은 아무 로직도 새로 만들지 않는다.

`describe()`가 각 부품 클래스 안에서 이미 정확한 정보를 내고 있다는 점도 눈여겨봐라. 3.3의 `sensor_hierarchy.cpp`는 `LidarSensor`와 `ImuSensor`를 `vector<Sensor>`에 값으로 넣으면 `describe()`가 베이스 버전만 불려 정보를 잃었다. 여기서는 애초에 `LidarSensor`와 `ImuSensor`가 서로 다른, 관계없는 타입이라 그런 슬롯 자체가 없다 — 각자 자기 타입으로 저장되고 자기 타입의 메서드가 불린다.

::: tip 이 책의 관례
위임 메서드 이름은 부품의 메서드 이름을 그대로 따르지 않고 `Robot`의 어휘로 다시 짓는다(`lidar_status()`이지 `describe()`가 아니다). 부품 타입을 나중에 바꿔도 `Robot`을 쓰는 코드가 그 사실을 몰라도 되게 하려는 것이다 — 위임도 이름을 그대로 뚫어 주는 통로가 아니라 그 자체로 하나의 인터페이스 설계다.
:::

## 상속의 비용이 컴포지션에서는 애초에 성립하지 않는다

3.3에서 실측한 세 가지 비용을 컴포지션 구조에 그대로 들이대 본다. 결과는 "고쳤다"가 아니라 "그 비용이 발생할 자리 자체가 없다"는 쪽이다.

### 슬라이싱: 자를 베이스가 없다

슬라이싱은 "정적 타입이 베이스인 값 슬롯에 파생 객체를 놓는" 상황에서만 일어난다. 컴포지션에는 그 베이스-파생 관계가 없다 — `Robot`을 값으로 넘겨도 `Robot`은 애초에 다른 무언가의 파생 타입이 아니므로 자를 대상이 없다.

```cpp title="no_slicing_by_value.cpp — Robot을 값으로 넘겨도 잃을 게 없다"
#include <iostream>
#include <string>

class LidarSensor {
public:
    LidarSensor(std::string frame_id, int beam_count)
        : frame_id_(std::move(frame_id)), beam_count_(beam_count) {}
    std::string describe() const {
        return "Lidar(" + frame_id_ + ", beams=" + std::to_string(beam_count_) + ")";
    }
private:
    std::string frame_id_;
    int beam_count_;
};

class Robot {
public:
    Robot() : lidar_("lidar_front", 16) {}
    std::string lidar_status() const { return lidar_.describe(); }
private:
    LidarSensor lidar_;
};

void log_robot(Robot r) {   // 값으로 받는다 -- 3.3이었다면 슬라이싱을 의심할 자리
    std::cout << "log_robot 안에서: " << r.lidar_status() << "\n";
}

int main() {
    Robot robot;
    std::cout << "원본:             " << robot.lidar_status() << "\n";
    log_robot(robot);   // Robot에는 "베이스 타입"이 없다 -- 자를 대상 자체가 없다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra no_slicing_by_value.cpp -o no_slicing_by_value
$ ./no_slicing_by_value
원본:             Lidar(lidar_front, beams=16)
log_robot 안에서: Lidar(lidar_front, beams=16)
```

(g++ 13.3 실측.) `log_robot(Robot r)`은 값으로 받지만 `beam_count_`가 사라지지 않는다. `Robot`을 복사하면 컴파일러는 `LidarSensor` 멤버까지 통째로 (멤버별) 복사한다 — 자를 "베이스 부분"이라는 개념 자체가 없으니 복사는 항상 전체다.

### 다이아몬드: 이름으로 구분되니 모호함이 없다

다이아몬드 문제는 같은 베이스가 상속 계층에서 두 경로로 합쳐질 때 생긴다. 컴포지션에서는 같은 타입의 부품을 여러 개 갖는 게 그냥 서로 다른 이름의 멤버 변수 두 개일 뿐이다.

```cpp title="no_diamond.cpp — 같은 타입 부품 두 개, 모호함 자체가 없다"
#include <iostream>
#include <string>

class LidarSensor {
public:
    explicit LidarSensor(std::string frame_id) : frame_id_(std::move(frame_id)) {}
    const std::string& frame_id() const { return frame_id_; }
private:
    std::string frame_id_;
};

// 같은 타입의 부품을 두 개 갖는다 -- 다중 상속이었다면 다이아몬드가 걱정될 상황
class FusedSensor {
public:
    FusedSensor() : front_("lidar_front"), rear_("lidar_rear") {}
    const std::string& front_frame() const { return front_.frame_id(); }   // 이름으로 구분 -- 모호함 자체가 성립 안 함
    const std::string& rear_frame() const { return rear_.frame_id(); }
private:
    LidarSensor front_;
    LidarSensor rear_;
};

int main() {
    FusedSensor fused;
    std::cout << "front = " << fused.front_frame() << "\n";
    std::cout << "rear  = " << fused.rear_frame() << "\n";
    std::cout << "sizeof(FusedSensor) = " << sizeof(FusedSensor) << "\n";
    std::cout << "sizeof(LidarSensor) = " << sizeof(LidarSensor) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra no_diamond.cpp -o no_diamond && ./no_diamond
front = lidar_front
rear  = lidar_rear
sizeof(FusedSensor) = 64
sizeof(LidarSensor) = 32
```

(g++ 13.3 실측.) 3.3의 `diamond_ambiguous.cpp`는 `fused.frame_id_`가 두 경로로 상속돼 컴파일러가 하나를 못 골랐다. 여기서는 `front_.frame_id()`와 `rear_.frame_id()`처럼 **어느 부품인지 멤버 이름이 이미 정해 준다** — 애초에 모호할 질문이 아니다. `sizeof(FusedSensor)` = 64는 `sizeof(LidarSensor)`(32)의 정확히 두 배다. 3.3의 `virtual` 상속 버전은 다이아몬드를 병합하면서도 48바이트(서브오브젝트 위치를 찾는 포인터 몇 개 추가)가 나왔는데, 컴포지션은 그런 위치 탐색 장치 자체가 필요 없어 정직하게 "부품 두 개 합친 크기"만 나온다.

::: perf 컴포지션은 메모리를 아끼는 기법이 아니다
`FusedSensor`가 64바이트인 건 `LidarSensor` 두 벌을 진짜로 갖고 있어서다 — 공유할 생각이 없으면 이게 맞는 크기다. 컴포지션의 이득은 "메모리 절약"이 아니라 "결합도 감소와 모호성 제거"다. 데이터를 정말 공유해야 하면(예: 여러 파생이 같은 설정 객체를 참조) `shared_ptr`나 레퍼런스 멤버로 공유하는 게 다이아몬드보다 훨씬 명확하다.
:::

## 컴포지션의 대가: 위임 코드는 저절로 따라오지 않는다

여기까지 보면 컴포지션이 상속의 비용을 전부 피하는 것처럼 보인다. 그런데 공짜가 아니다. **public 상속은 베이스의 public 인터페이스 전체를 파생 클래스 밖에서 그대로 호출 가능하게 만든다** — 아무것도 안 써도 된다. 컴포지션은 그 반대다. 부품 객체는 `private` 멤버이므로, 그 인터페이스를 바깥에 다시 내주려면 메서드 하나하나를 손으로 다시 써야 한다.

```cpp title="delegation_boilerplate.cpp — 인터페이스 하나마다 위임 메서드 하나"
#include <iostream>
#include <string>

class Sensor {
public:
    explicit Sensor(std::string frame_id) : frame_id_(std::move(frame_id)) {}
    const std::string& frame_id() const { return frame_id_; }
    double last_reading() const { return last_reading_; }
    int error_count() const { return error_count_; }
    void calibrate() { last_reading_ = 0.0; error_count_ = 0; }
private:
    std::string frame_id_;
    double last_reading_ = 0.0;
    int error_count_ = 0;
};

// Sensor의 public 인터페이스를 그대로 쓰고 싶으면, 메서드마다 한 줄씩 다시 써야 한다
class Robot {
public:
    Robot() : sensor_("lidar_front") {}

    const std::string& frame_id() const { return sensor_.frame_id(); }
    double last_reading() const { return sensor_.last_reading(); }
    int error_count() const { return sensor_.error_count(); }
    void calibrate() { sensor_.calibrate(); }

private:
    Sensor sensor_;
};

int main() {
    Robot robot;
    robot.calibrate();
    std::cout << "frame_id = " << robot.frame_id() << "\n";
    std::cout << "reading  = " << robot.last_reading() << "\n";
    std::cout << "errors   = " << robot.error_count() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra delegation_boilerplate.cpp -o delegation_boilerplate
$ ./delegation_boilerplate
frame_id = lidar_front
reading  = 0
errors   = 0
```

(g++ 13.3 실측.) `Sensor`의 public 메서드가 4개면 `Robot`도 4개를 다시 써야 한다. `Sensor`에 메서드가 하나 추가되면 `Robot`도 잊지 않고 하나 더 추가해야 한다 — 상속이었다면 `using Sensor::새메서드;`조차 필요 없이 그냥 보였을 일이다.

::: deep 왜 컴포지션에는 자동 노출이 없는가
[3.3](#/inheritance)의 이름 탐색은 파생 클래스 스코프에서 이름을 못 찾으면 베이스 스코프까지 올라간다 — `Derived` 객체로 베이스의 public 메서드를 부르면 이 규칙 덕에 그냥 호출된다. 컴포지션은 `sensor_`가 `Robot`의 **멤버**이지 `Robot`이 `Sensor` 스코프를 상속한 게 아니다. `robot.frame_id()`를 부르면 컴파일러는 `Robot` 스코프만 보고, 거기 없으면 탐색이 끝난다 — `sensor_.frame_id()`까지 내려가 주는 규칙이 없다. 위임 메서드는 이 탐색 규칙의 빈자리를 손으로 메우는 코드다.
:::

::: warn 위임 누락은 컴파일러가 못 잡는다
`Sensor`에 새 public 메서드를 추가했는데 `Robot`의 위임 메서드를 깜빡해도 컴파일은 통과한다. 그 기능이 `Robot` 밖에서 안 보일 뿐이다 — 이 절 앞부분의 protected 버그(컴파일은 통과하지만 조용히 틀림)와 종류는 다르지만 "위험이 컴파일 타임에 드러나지 않는다"는 성격은 닮았다. 위임 메서드가 많아질수록 이 실수 가능성도 늘어난다는 게 컴포지션의 실제 비용이다.
:::

**"Prefer composition over inheritance"**는 1994년 GoF의 『Design Patterns』가 대중화한 격언이다. "상속을 아예 쓰지 마라"가 아니라 "**단지 기능 재사용이 목적이면** 컴포지션을 먼저 검토하라"는 뜻이다. is-a가 실제로 성립하는 경우까지 컴포지션으로 우겨넣으면 방금 본 위임 보일러플레이트가 정직하게 쌓인다.

## 그래도 상속이 맞는 경우: 다형적으로 다뤄야 할 때

컴포지션으로 못 하는 게 하나 있다 — **정적 타입이 다른 여러 객체를, 호출하는 쪽이 구체 타입을 몰라도 되게 하나의 컨테이너·하나의 인터페이스로 다루는 것.** `Shape` 여러 종류를 한 벡터에 담고 반복문 하나로 넓이를 합산하는 경우를 본다.

```cpp title="polymorphic_needed.cpp — 서로 다른 구체 타입을 하나의 포인터 타입으로 순회한다"
#include <iostream>
#include <memory>
#include <vector>

class Shape {
public:
    virtual ~Shape() = default;
    virtual double area() const = 0;
};

class Circle : public Shape {
public:
    explicit Circle(double r) : r_(r) {}
    double area() const override { return 3.14159265 * r_ * r_; }
private:
    double r_;
};

class Square : public Shape {
public:
    explicit Square(double side) : side_(side) {}
    double area() const override { return side_ * side_; }
private:
    double side_;
};

int main() {
    std::vector<std::unique_ptr<Shape>> shapes;
    shapes.push_back(std::make_unique<Circle>(2.0));
    shapes.push_back(std::make_unique<Square>(3.0));

    double total = 0.0;
    for (const auto& s : shapes) total += s->area();   // 어떤 파생 타입인지 호출자는 몰라도 된다

    std::cout << "총 넓이 = " << total << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra polymorphic_needed.cpp -o polymorphic_needed && ./polymorphic_needed
총 넓이 = 21.5664
```

(g++ 13.3 실측.) `Circle`과 `Square`를 컴포지션으로 바꾸면 이 반복문이 성립하지 않는다 — `vector<Circle>`과 `vector<Square>`를 따로 만들거나, `if (holds_circle) ... else if (holds_square) ...` 식으로 타입을 직접 분기해야 한다. 어느 쪽이든 `Shape` 종류가 늘어날 때마다 이 반복문 자체를 고쳐야 한다 — 다형성이 없애 주던 결합이 되살아난다. **정말 다형적으로 다뤄야 하는 관계는 상속(또는 [3.5 추상 클래스와 인터페이스 설계](#/abstract-interfaces)의 순수 인터페이스)이 옳은 선택이다.**

로봇 SW 스택에서 이 판단은 선택 사항이 아니라 프레임워크가 강제하는 경우가 많다. [11.1 pluginlib와 플러그인 아키텍처](#/pluginlib)는 런타임에 어떤 costmap 레이어·컨트롤러 플러그인이 로드될지 컴파일 시점에 알 수 없다 — 그래서 특정 베이스 클래스의 상속(순수 가상함수 구현)을 로더 API의 필수 조건으로 못 박는다. 컴포지션으로는 "아직 이름도 모르는 미래의 구체 타입"을 표준 인터페이스 하나로 다룰 방법이 없다 — 다형성 자체가 상속의 존재 이유이기 때문이다.

::: interview 컴포지션과 상속을 언제 선택하나
답변 뼈대: ① **판단 기준은 리스코프 치환 원칙** — `Derived`를 `Base` 자리에 넣어도 프로그램이 옳게 동작하면 is-a, 상속 후보. 아니면 has-a, 컴포지션 후보. ② **다형적으로 다뤄야 하는가**가 실전 판단 질문 — 베이스 타입 포인터로 여러 구체 타입을 동일하게 처리해야 하면(`vector<unique_ptr<Base>>`, 플러그인 로더) 상속이 필요하고, 단순히 구현을 재사용하고 싶을 뿐이면 컴포지션으로 충분하다. ③ **"Prefer composition over inheritance"의 의미** — 상속 전면 금지가 아니라 목적이 재사용뿐일 때 컴포지션을 먼저 검토하라는 것(GoF `Design Patterns`, 1994). ④ **컴포지션의 대가** — 베이스의 public 인터페이스가 자동으로 노출되지 않아 메서드마다 위임 코드를 손으로 써야 하고, 누락은 컴파일러가 못 잡는다. ⑤ 후속 질문 "상속의 대표적 비용 세 가지는?"에는 3.3의 슬라이싱·protected 결합·다이아몬드로 답하고, 컴포지션이 그 셋을 구조적으로(베이스-파생 관계 자체가 없어서) 피한다는 것까지 답하면 완결된다.
:::

## 결정 체크리스트

새 클래스 관계를 짤 때 이 순서로 묻는다.

1. **`Derived`를 `Base`가 쓰이는 모든 자리에 대신 넣어도 프로그램이 옳게 동작하는가?**(리스코프 치환) — 예외를 던지거나 계약을 못 지키면 아니오다. 상속 후보에서 제외하고 컴포지션으로 간다.
2. **베이스 타입 포인터·레퍼런스로 여러 구체 타입을 동일하게 다뤄야 하는가?**(다형성이 실제로 필요한가) — `vector<unique_ptr<Base>>`처럼 구체 타입을 모른 채 처리하는 코드가 없고 그냥 "구현을 가져다 쓰고 싶다"뿐이면 컴포지션으로 충분하다.
3. **프레임워크나 API가 특정 베이스 상속을 요구하는가?** `pluginlib`의 클래스 로더처럼 계약 자체가 상속을 전제하면 위 두 질문과 별개로 상속이 정답이다.
4. 1·2·3 전부 아니오면 컴포지션이다. 위임 메서드가 몇 개나 필요할지, 그 보일러플레이트를 감당할 가치가 있는지 미리 세어 봐라.

## 요약

- 상속은 결합도가 가장 강한 관계다. protected 접근자 패턴으로 짠 코드를 컴포지션으로 다시 짜면 `protected` 지정자 자체가 필요 없어진다 — 접근 권한을 계층 전체와 약속할 이유가 없어지기 때문이다.
- **리스코프 치환 원칙**: `Derived`를 `Base` 자리에 넣어도 항상 옳게 동작해야 진짜 is-a다. `FixedTurret`처럼 이름은 하위 개념 같아도 계약(`move()`)을 못 지키면 상속을 쓰면 안 된다.
- 컴포지션에서는 3.3의 세 비용이 구조적으로 성립하지 않는다 — 슬라이싱은 "자를 베이스"가 없어서, 다이아몬드는 부품이 이름으로 구분돼 모호성 자체가 없어서 각각 사라진다(실측: `sizeof(FusedSensor)=64`는 정직하게 부품 두 배).
- 컴포지션은 공짜가 아니다. **부품의 public 인터페이스는 자동으로 노출되지 않는다** — 위임 메서드를 메서드마다 손으로 써야 하고, 새 메서드 추가 시 위임을 빠뜨려도 컴파일러가 못 잡는다.
- "Prefer composition over inheritance"는 상속 금지가 아니라 "**목적이 재사용뿐이면** 컴포지션 먼저"라는 뜻이다. 정말 다형적으로 다뤄야 하는 관계(`vector<unique_ptr<Base>>`, `pluginlib` 같은 플러그인 로더)에는 상속이 여전히 정답이다.
- 판단 순서: ① 리스코프 치환이 성립하는가 → ② 다형적으로 다뤄야 하는가 → ③ 프레임워크가 상속을 강제하는가. 셋 다 아니면 컴포지션이다.

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. `lsp_violation.cpp`의 `FixedTurret`이 리스코프 치환 원칙을 위반하는 이유를 `patrol()` 함수의 관점에서 설명하라. `move()`를 순수 가상함수로 두지 않고 `FixedTurret`이 그냥 상속만 안 받게 했다면(컴포지션으로 바꿨다면) 이 문제가 어떻게 사라지는지도 함께 답하라.
2. `no_diamond.cpp`의 `FusedSensor`가 3.3의 `virtual` 상속 버전보다 `sizeof`가 더 큰데(64 vs 48), 왜 이게 "컴포지션이 손해"라는 뜻이 아닌지 설명하라.
3. `delegation_boilerplate.cpp`의 `Sensor`에 `void reset_errors()`라는 public 메서드를 추가하고 `Robot`에는 위임 메서드를 추가하지 않으면, 컴파일이 실패하는지 성공하는지 예측하고 그 이유를 설명하라.
4. (실습) 임의의 두 클래스로 `Base`/`Derived` 상속 관계를 짜되, `Derived`가 `Base`의 계약을 지키지 못하는(리스코프 치환 위반) 사례를 하나 만들어라. 그 다음 같은 기능을 컴포지션으로 다시 짜서 위반이 사라짐을 확인하라.
5. (실습) `robot_composition.cpp`의 `Robot`에 세 번째 부품(임의의 센서 클래스)을 추가하고, 그에 맞는 위임 메서드를 작성하라. `g++ -std=c++20 -Wall -Wextra -fsanitize=address`로 빌드해 경고와 새니타이저 리포트가 없는지 확인하라.
:::

::: answer 해설
1. `patrol(Robot& r)`은 `r.move(1.0)`이 실제로 로봇을 이동시킨다는 암묵적 계약을 전제로 짜여 있다. `FixedTurret`은 그 계약을 예외로 깨므로, `fleet`을 순회하는 호출자는 자신이 다루는 게 어떤 구체 타입인지 몰라야 하는데도 실제로는 "혹시 `FixedTurret`이면 예외가 난다"는 걸 알고 방어해야 한다. 컴포지션으로 바꾸면(`FixedTurret`이 `Robot`을 상속하지 않으면) 애초에 `patrol(Robot&)`이 받아 줄 자리가 없어져 이 오용 자체가 컴파일 시점에 걸러진다.
2. `virtual` 상속 버전(48바이트)은 `Sensor` 서브오브젝트 한 벌을 공유하는 대신 런타임 위치 탐색 포인터를 부담한다 — 메모리는 아끼되 탐색 비용과 사용법의 복잡함을 대신 낸다. 컴포지션 버전(64바이트)은 애초에 독립적인 부품 두 벌을 진짜로 갖고 있으므로 이게 정확한 크기다. "손해"인지는 데이터를 공유할 이유가 있었는지에 달려 있지, 바이트 수만으로 판단할 문제가 아니다.
3. 성공한다. `Sensor`에 메서드를 추가하는 것 자체는 `Robot`의 컴파일에 영향을 주지 않는다 — `Robot`은 `sensor_.reset_errors()`를 호출하는 코드가 없을 뿐이고, 그 기능이 `Robot` 밖에 안 보이는 것도 컴파일 에러가 아니라 그냥 "아직 위임을 안 쓴" 상태다. 이게 이 절이 지적한 위임 누락의 위험 — 조용히 기능이 빠진 채로 컴파일이 통과한다.
4. `Base`에 순수 가상함수로 계약을 걸고 `Derived`가 그 계약을 예외나 무동작으로 어기게 만들면 된다(`lsp_violation.cpp` 패턴 재사용). 컴포지션 버전은 `Derived`가 `Base`를 상속하지 않고 필요한 기능만 멤버로 가져와 위임하면, 애초에 계약을 어길 자리(상속 관계) 자체가 사라진다.
5. `robot_composition.cpp`의 `LidarSensor`/`ImuSensor` 선언을 참고해 세 번째 클래스를 추가하고, `Robot`에 그 클래스의 `describe()` 계열 메서드 하나를 위임하면 된다. ASan 빌드가 리포트 없이 종료되면 값 멤버로만 구성된 `Robot`이 별도 힙 관리 없이 안전하다는 뜻이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `inherit_side.cpp`와 `compose_side.cpp`를 나란히 열어 두고 `protected`를 하나씩 지워 가며 어디서 컴파일이 막히는지 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [3.8 클래스 설계 실전](#/class-design) — 이 절의 체크리스트로 관계를 정했다면, 다음 절은 그렇게 정해진 클래스 하나하나를 const 정확성과 최소 인터페이스 원칙으로 다듬는 법을 로봇 도메인 예제로 본다.
