# 3.3 상속: is-a의 비용

::: lead
[3.1 클래스](#/classes)에서 캡슐화와 불변식을, [3.2 생성자와 소멸자](#/constructors)에서 객체가 만들어지고 사라지는 순서를 봤다. 상속은 그 위에 "이 타입은 저 타입의 한 종류다(is-a)"라는 관계를 얹는다. 문법은 콜론 하나(`: public Base`)로 끝나지만, 값으로 다루는 순간 파생 클래스가 조용히 잘려나가는 객체 슬라이싱, protected가 만드는 숨은 결합, 다중 상속의 다이아몬드까지 — 공짜가 아닌 비용이 뒤따른다. 이 절은 상속 문법 자체와 그 비용에 집중한다. 상속의 진짜 존재 이유인 동적 디스패치(가상함수, vtable)는 [3.4 가상함수와 vtable](#/virtual-vtable)로 넘긴다.
:::

## 문제부터: 값으로 받으면 파생 부분이 통째로 사라진다

`LidarSensor`는 `Sensor`를 상속하며 `beam_count_`라는 자기만의 멤버를 하나 더 가진다. `describe()`도 각자 다시 정의했다. 이 객체를 로그 유틸리티 `log_sensor(Sensor s)`에 넘긴다 — 매개변수 타입이 포인터도 레퍼런스도 아닌 `Sensor` **값**이다.

```cpp title="slicing_by_value.cpp — 파생 클래스를 베이스 값으로 받는다"
#include <iostream>
#include <string>

class Sensor {
public:
    explicit Sensor(std::string name) : name_(std::move(name)) {}
    std::string describe() const { return "Sensor(" + name_ + ")"; }
    std::string name_;
};

class LidarSensor : public Sensor {
public:
    LidarSensor(std::string name, int beam_count)
        : Sensor(std::move(name)), beam_count_(beam_count) {}
    std::string describe() const {
        return "Lidar(" + name_ + ", beams=" + std::to_string(beam_count_) + ")";
    }
    int beam_count_;
};

void log_sensor(Sensor s) {   // 값으로 받는다 -- 여기가 슬라이싱 지점
    std::cout << "log_sensor 안에서: " << s.describe() << "\n";
}

int main() {
    LidarSensor lidar("front", 16);
    std::cout << "원본:               " << lidar.describe() << "\n";
    std::cout << "sizeof(Sensor)      = " << sizeof(Sensor) << "\n";
    std::cout << "sizeof(LidarSensor) = " << sizeof(LidarSensor) << "\n";
    log_sensor(lidar);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra slicing_by_value.cpp -o slicing_by_value
$ ./slicing_by_value
원본:               Lidar(front, beams=16)
sizeof(Sensor)      = 32
sizeof(LidarSensor) = 40
log_sensor 안에서: Sensor(front)
```

(g++ 13.3 / libstdc++ 실측. `std::string`은 SSO 구현 때문에 32바이트를 차지한다 — 표준이 보장하는 값은 아니지만 이 환경에서는 그렇다.) 원본 `lidar.describe()`는 `beams=16`까지 정확히 찍는다. 그런데 `log_sensor` 안에서는 그 정보가 통째로 사라진 `Sensor(front)`만 나온다.

`LidarSensor`를 `Sensor` 매개변수에 값으로 넘기는 순간, 컴파일러는 딱 `sizeof(Sensor)` = 32바이트만큼만 복사한다. `beam_count_`가 얹혀 앉은 나머지 8바이트(정렬 때문에 `int` 4바이트가 8바이트 자리를 차지한다)는 그 복사본에 애초에 담길 공간이 없다. `sizeof(LidarSensor)` = 40이 그 증거다 — 파생 타입이 8바이트 더 크다는 것은 곧 "베이스 타입의 상자에는 그만큼 더 못 담는다"는 뜻이다. 이 현상을 **객체 슬라이싱**(object slicing)이라 부른다: 파생 객체를 베이스 타입의 값으로 다루면, 파생 부분이 정말로 물리적으로 잘려나간다.

::: danger 슬라이싱은 버그가 아니라 정의된 동작이다
컴파일러는 경고 하나 없이 이 코드를 통과시켰다(`-Wall -Wextra` 포함). 표준은 파생 객체가 베이스 타입으로 변환될 때 베이스 서브오브젝트만 복사하도록 명시적으로 정의해 뒀다 — 미정의 동작(UB)이 아니라 **완벽하게 유효한 문법**이다. `void log_sensor(Sensor s)`라는 시그니처 자체가 "나는 베이스 부분만 필요하다"는 뜻으로 합법적이다. 문제는 언어가 아니라 작성자의 의도(파생 타입 그대로 다루고 싶었다)와 시그니처가 실제로 하는 일(베이스로 자른다)이 어긋난 데 있다.
:::

## 상속 문법: 콜론 하나, 그러나 세 가지 의미

```cpp
class LidarSensor : public Sensor { /* ... */ };
```

콜론 뒤의 `public`은 **상속 방식**을 정한다. 세 가지가 있다.

- **public 상속**: `Base`의 `public` 멤버는 `Derived` 밖에서도 `public`, `protected` 멤버는 `Derived` 안에서 `protected`로 남는다. "`Derived` is-a `Base`"가 실제로 성립한다 — 이 책이 실전에서 쓰는 유일한 형태다.
- **protected 상속**: `Base`의 `public`/`protected` 멤버가 `Derived` 안에서 전부 `protected`로 격하된다. `Derived` 밖에서는 `Base*`로 캐스팅할 수조차 없다. "구현만 물려받고 is-a는 성립시키지 않는다"는 의도인데, 실무 로봇 코드베이스에서 쓰인 사례를 보기 어렵다 — 존재만 알아두면 된다.
- **private 상속**: `Base`의 멤버가 `Derived` 안에서 전부 `private`이 된다. protected 상속보다 더 닫힌 "구현 재사용"이다. 이 의도가 필요해 보이면 이 책은 상속 대신 [3.7 컴포지션 vs 상속](#/composition)에서 다루는 멤버 변수로 갖는 방식을 먼저 검토하라고 권한다 — 클래스 하나가 다른 클래스를 "포함한다"는 의도가 코드에 직접 드러난다.

::: tip 이 책의 관례
**public 상속만 쓴다.** protected/private 상속이 필요해 보이는 설계는 대부분 컴포지션으로 바꾸면 더 명확해진다. 이후 절의 모든 예제는 public 상속을 전제한다.
:::

### 베이스 클래스 생성자 호출

`Sensor`에 매개변수를 받는 생성자만 있으면(기본 생성자가 없으면), `LidarSensor`는 멤버 초기화 리스트에서 그 생성자를 **명시적으로** 호출해야 한다.

```cpp title="construction_order.cpp — 베이스가 먼저 생성되고 나중에 소멸한다"
#include <iostream>
#include <string>

class Sensor {
public:
    explicit Sensor(std::string name) : name_(std::move(name)) {
        std::cout << "Sensor(" << name_ << ") 생성자\n";
    }
    ~Sensor() { std::cout << "Sensor(" << name_ << ") 소멸자\n"; }
    std::string name_;
};

class LidarSensor : public Sensor {
public:
    LidarSensor(std::string name, int beams)
        : Sensor(std::move(name)), beam_count_(beams) {   // 베이스 생성자를 명시적으로 호출
        std::cout << "LidarSensor 생성자 (beams=" << beam_count_ << ")\n";
    }
    ~LidarSensor() { std::cout << "LidarSensor 소멸자\n"; }
    int beam_count_;
};

int main() {
    LidarSensor lidar("front", 16);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra construction_order.cpp -o construction_order
$ ./construction_order
Sensor(front) 생성자
LidarSensor 생성자 (beams=16)
LidarSensor 소멸자
Sensor(front) 소멸자
```

순서는 항상 고정이다 — **베이스가 먼저 생성되고 마지막에 소멸한다.** 멤버 초기화 리스트에 `Sensor(std::move(name))`을 적지 않으면 컴파일러는 `Sensor`의 기본 생성자를 찾는데, 이 예제처럼 `Sensor`에 기본 생성자가 없으면 그 자리에서 컴파일이 멈춘다 — "어떤 이름으로 베이스를 생성할지" 자체를 파생 클래스가 책임져야 한다는 뜻이다.

### 왜 파생 클래스가 베이스의 private에 못 닿는가

```cpp title="private_member_denied.cpp — 파생 클래스도 private엔 못 닿는다"
#include <string>

class Sensor {
public:
    explicit Sensor(std::string name) : name_(std::move(name)) {}
protected:
    std::string frame_id_ = "sensor_frame";
private:
    int raw_reading_ = 0;
    std::string name_;
};

class LidarSensor : public Sensor {
public:
    LidarSensor(std::string name) : Sensor(std::move(name)) {}
    int read() const { return raw_reading_; }   // private 멤버 접근 시도
};

int main() { return 0; }
```

```console
$ g++ -std=c++20 -Wall -Wextra private_member_denied.cpp -o private_member_denied
private_member_denied.cpp: In member function 'int LidarSensor::read() const':
private_member_denied.cpp:16:31: error: 'int Sensor::raw_reading_' is private within this context
   16 |     int read() const { return raw_reading_; }   // private 멤버 접근 시도
      |                               ^~~~~~~~~~~~
private_member_denied.cpp:9:9: note: declared private here
    9 |     int raw_reading_ = 0;
      |         ^~~~~~~~~~~~
```

`private`는 "이 클래스 자신에게만"이라는 뜻이지 "이 계층 전체에게"가 아니다. `frame_id_`처럼 파생 클래스까지 경계를 넓히고 싶으면 `protected`를 쓴다. 그런데 그 경계 확장에는 대가가 따른다 — 다음 절의 주제다.

## protected의 함정: 접근을 열어주는 대신 결합도를 떠넘긴다

`protected`는 매력적으로 보인다. 파생 클래스가 게터/세터 없이 베이스의 내부 데이터에 바로 닿을 수 있다. 문제는 그 순간 **베이스의 내부 표현이 모든 파생 클래스와의 암묵적 계약이 된다**는 것이다. `Sensor`가 거리를 센티미터로 저장한다고 가정하고 파생 클래스가 그 단위를 알아서 계산하는 코드를 짠다.

```cpp title="protected_before.cpp — protected 멤버를 파생이 직접 읽는다 (센티미터 가정)"
#include <iostream>

class Sensor {
protected:
    double raw_range_ = 250.0;   // 센티미터 단위로 저장한다고 가정
};

class LidarSensor : public Sensor {
public:
    double range_in_meters() const {
        return raw_range_ / 100.0;   // Sensor가 cm로 저장한다는 걸 알고 직접 계산
    }
};

int main() {
    LidarSensor lidar;
    std::cout << "range = " << lidar.range_in_meters() << " m\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra protected_before.cpp -o protected_before && ./protected_before
range = 2.5 m
```

지금은 맞다. 그런데 나중에 `Sensor`를 다른 목적으로 쓰던 개발자가 "어차피 미터로 쓰는 곳이 더 많다"며 저장 단위를 바꾼다고 해보자. `LidarSensor`의 코드는 한 글자도 안 건드렸다.

```cpp title="protected_after.cpp — Sensor 내부 구현을 미터 단위로 바꿨다"
#include <iostream>

class Sensor {
protected:
    double raw_range_ = 2.5;   // 리팩터링: 이제 미터 단위로 직접 저장한다
};

class LidarSensor : public Sensor {
public:
    double range_in_meters() const {
        return raw_range_ / 100.0;   // 코드는 그대로다 -- 하지만 이제 틀렸다
    }
};

int main() {
    LidarSensor lidar;
    std::cout << "range = " << lidar.range_in_meters() << " m\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra protected_after.cpp -o protected_after && ./protected_after
range = 0.025 m
```

`2.5 m`가 나와야 할 자리에 `0.025 m`가 나왔다. **컴파일은 경고 하나 없이 통과했다** — 타입은 여전히 `double`이고 문법은 여전히 유효하기 때문이다. 깨진 건 "베이스가 이런 단위로 저장한다"는, 코드 어디에도 적혀 있지 않던 암묵적 약속이다. `LidarSensor`가 하나뿐이면 금방 찾겠지만, 같은 `protected raw_range_`를 읽는 파생 클래스가 다섯 개, 열 개면 전부 하나씩 확인해야 한다.

::: warn protected 멤버를 바꾸는 순간 모든 파생 클래스가 재검토 대상이다
`protected` 데이터 멤버는 사실상 "이 계층 전체에 공개된 전역 변수"에 가깝다. 베이스 클래스 하나를 고치면 그 표현에 의존하는 모든 파생 클래스를 다시 읽어야 안전한지 확인할 수 있다 — `public` 인터페이스를 바꿀 때와 똑같은 무게다.
:::

대안은 데이터는 `private`로 숨기고, 파생 클래스에게는 `protected` **접근자 메서드**만 내주는 것이다. 표현이 바뀌어도 변환 로직을 그 메서드 한 곳에서만 고치면 된다.

```cpp title="private_plus_accessor.cpp — private로 감추고 접근자 메서드로 통제한다"
#include <iostream>

class Sensor {
protected:
    double range_meters() const { return raw_range_meters_; }   // 단위 변환은 이 한 곳에서만
private:
    double raw_range_meters_ = 2.5;
};

class LidarSensor : public Sensor {
public:
    double range_in_meters() const { return range_meters(); }
};

int main() {
    LidarSensor lidar;
    std::cout << "range = " << lidar.range_in_meters() << " m\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra private_plus_accessor.cpp -o private_plus_accessor && ./private_plus_accessor
range = 2.5 m
```

`Sensor`가 내부 저장 단위를 다시 바꿔도 `range_meters()`의 몸체 한 줄만 고치면 모든 파생 클래스가 그대로 맞는다 — 원시 데이터 대신 **좁은 인터페이스**를 파생 클래스에게 넘겼기 때문이다. `protected` 데이터가 필요해 보이면 먼저 이 패턴을 시도해라.

## 객체 슬라이싱의 해부: 세 지점과 물리적 크기

첫 절의 슬라이싱을 값으로 전달하는 경우 하나만 봤다. 실제로는 세 지점에서 똑같은 일이 일어난다 — **값으로 전달, 값으로 반환, 컨테이너에 값으로 저장.**

```cpp title="slicing_three_points.cpp — 슬라이싱이 일어나는 세 지점"
#include <iostream>
#include <string>
#include <vector>

class Sensor {
public:
    explicit Sensor(std::string name) : name_(std::move(name)) {}
    std::string describe() const { return "Sensor(" + name_ + ")"; }
    std::string name_;
};

class ImuSensor : public Sensor {
public:
    ImuSensor(std::string name, int hz) : Sensor(std::move(name)), hz_(hz) {}
    std::string describe() const {
        return "Imu(" + name_ + ", " + std::to_string(hz_) + "Hz)";
    }
    int hz_;
};

// 지점 1: 값으로 전달
void log_sensor(Sensor s) { std::cout << "[전달]     " << s.describe() << "\n"; }

// 지점 2: 값으로 반환
Sensor make_default_sensor(const ImuSensor& imu) {
    return imu;   // 반환 타입이 Sensor다 -- 여기서 슬라이싱된다
}

int main() {
    ImuSensor imu("chassis", 200);
    std::cout << "원본:      " << imu.describe() << "\n";

    log_sensor(imu);                                             // 지점 1: 전달

    Sensor returned = make_default_sensor(imu);
    std::cout << "[반환]     " << returned.describe() << "\n";   // 지점 2: 반환

    std::vector<Sensor> sensors;
    sensors.push_back(imu);                                       // 지점 3: 컨테이너
    std::cout << "[컨테이너] " << sensors[0].describe() << "\n";

    std::cout << "sizeof(Sensor)    = " << sizeof(Sensor) << "\n";
    std::cout << "sizeof(ImuSensor) = " << sizeof(ImuSensor) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra slicing_three_points.cpp -o slicing_three_points
$ ./slicing_three_points
원본:      Imu(chassis, 200Hz)
[전달]     Sensor(chassis)
[반환]     Sensor(chassis)
[컨테이너] Sensor(chassis)
sizeof(Sensor)    = 32
sizeof(ImuSensor) = 40
```

세 지점 전부 `200Hz`라는 정보가 사라졌다. 공통점은 하나다 — **정적 타입이 `Sensor`인 자리에 값을 놓았다.** `make_default_sensor`의 반환 타입을 `Sensor`로 정하는 순간, `return imu;`는 `imu`를 `Sensor`로 암묵 변환해 임시 객체를 만들고 그걸 반환한다. `sensors.push_back(imu)`도 마찬가지다 — `std::vector<Sensor>`는 저장 공간을 `sizeof(Sensor)` = 32바이트 단위로만 잡아 두므로, `push_back`은 `imu`를 `Sensor`로 변환한 사본을 그 32바이트 자리에 복사한다. `hz_`가 앉을 자리는 처음부터 존재하지 않는다.

이 절은 해법을 다루지 않는다. 포인터나 레퍼런스로 다루면 슬라이싱 자체가 일어나지 않는다 — `sizeof(Sensor*)`는 가리키는 대상이 `Sensor`든 `ImuSensor`든 항상 8바이트이고, 힙에 놓인 원본 객체는 그대로 남아 있다. 그 포인터로 각 파생 타입의 진짜 동작을 부르는 방법이 가상함수이고, [3.4 가상함수와 vtable](#/virtual-vtable)의 주제다.

## 다중 상속과 다이아몬드 문제

C++은 콤마로 베이스를 여러 개 나열하는 다중 상속을 허용한다.

```cpp
class FusedSensor : public LidarSensor, public ImuSensor { /* ... */ };
```

`LidarSensor`와 `ImuSensor`가 독립된 클래스라면 문제없다. 그런데 둘 다 `Sensor`를 상속한 상태에서 `FusedSensor`가 그 둘을 동시에 상속하면, 같은 베이스가 두 경로로 들어온다.

```cpp title="diamond_sizeof.cpp — 같은 베이스를 두 경로로 상속"
#include <iostream>
#include <string>

class Sensor {
public:
    std::string frame_id_ = "base_frame";
};

class LidarSensor : public Sensor {};
class ImuSensor : public Sensor {};

class FusedSensor : public LidarSensor, public ImuSensor {};   // 다중 상속

int main() {
    std::cout << "sizeof(Sensor)      = " << sizeof(Sensor) << "\n";
    std::cout << "sizeof(LidarSensor) = " << sizeof(LidarSensor) << "\n";
    std::cout << "sizeof(FusedSensor) = " << sizeof(FusedSensor) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra diamond_sizeof.cpp -o diamond_sizeof && ./diamond_sizeof
sizeof(Sensor)      = 32
sizeof(LidarSensor) = 32
sizeof(FusedSensor) = 64
```

`FusedSensor`는 `Sensor`(32바이트) 하나가 아니라 정확히 **두 배**다 — `LidarSensor` 경로의 `Sensor` 서브오브젝트 하나, `ImuSensor` 경로의 `Sensor` 서브오브젝트 하나, 도합 둘이다. `frame_id_`도 두 벌이라, 그냥 읽으려 하면 컴파일러가 어느 것인지 고르지 못한다.

```cpp title="diamond_ambiguous.cpp — 어느 frame_id_인지 컴파일러가 못 고른다"
#include <string>

class Sensor { public: std::string frame_id_ = "base_frame"; };
class LidarSensor : public Sensor {};
class ImuSensor : public Sensor {};
class FusedSensor : public LidarSensor, public ImuSensor {};

int main() {
    FusedSensor fused;
    return fused.frame_id_.empty();   // LidarSensor::frame_id_ 인가 ImuSensor::frame_id_ 인가
}
```

```console
$ g++ -std=c++20 -Wall -Wextra diamond_ambiguous.cpp -o diamond_ambiguous
diamond_ambiguous.cpp: In function 'int main()':
diamond_ambiguous.cpp:10:18: error: request for member 'frame_id_' is ambiguous
   10 |     return fused.frame_id_.empty();   // LidarSensor::frame_id_ 인가 ImuSensor::frame_id_ 인가
      |                  ^~~~~~~~~
diamond_ambiguous.cpp:3:36: note: candidates are: 'std::string Sensor::frame_id_'
```

이것이 **다이아몬드 문제**다 — 상속 그래프를 그리면 `Sensor` 하나에서 두 갈래로 갈라졌다가 `FusedSensor`에서 다시 합쳐지는 마름모(다이아몬드) 모양이 된다. `virtual` 상속을 쓰면 베이스를 단 한 벌만 공유하도록 강제할 수 있다.

```cpp title="diamond_virtual_fix.cpp — virtual 상속으로 중복을 없앤다"
#include <iostream>
#include <string>

class Sensor { public: std::string frame_id_ = "base_frame"; };
class LidarSensor : public virtual Sensor {};
class ImuSensor : public virtual Sensor {};
class FusedSensor : public LidarSensor, public ImuSensor {};

int main() {
    FusedSensor fused;
    std::cout << "frame_id_ = " << fused.frame_id_ << "\n";   // 이제 하나뿐이라 모호하지 않다
    std::cout << "sizeof(FusedSensor) = " << sizeof(FusedSensor) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra diamond_virtual_fix.cpp -o diamond_virtual_fix && ./diamond_virtual_fix
frame_id_ = base_frame
sizeof(FusedSensor) = 48
```

`frame_id_`가 하나로 합쳐져 모호함이 사라졌다. 그런데 `sizeof(FusedSensor)`는 32(`Sensor` 한 벌)가 아니라 48이다 — 가상 베이스의 실제 위치를 런타임에 찾기 위한 포인터 몇 개가 추가로 붙는다. 그 내부 구조는 [3.4](#/virtual-vtable)의 vtable 메커니즘과 같은 종류의 이야기라 여기서는 깊이 들어가지 않는다.

::: tip 이 책의 관례
**다중 상속은 데이터 멤버가 없는 순수 인터페이스에만 쓴다.** 실제 데이터를 가진 베이스 두 개를 동시에 상속하는 설계는 거의 항상 이 다이아몬드를 만든다. 데이터가 있는 여러 베이스가 필요해 보이면 [3.7 컴포지션 vs 상속](#/composition)으로 바꿀 방법부터 찾는다. 인터페이스로만 쓰는 다중 상속은 [3.5 추상 클래스와 인터페이스 설계](#/abstract-interfaces)에서 실제 패턴으로 이어간다.
:::

## using으로 가려진 이름을 되살린다

파생 클래스가 베이스와 **이름은 같지만 시그니처가 다른** 함수를 선언하면, 그 이름의 베이스 오버로드 전부가 가려진다. 오버로드 집합에 하나 추가되는 게 아니라, 이름 전체가 새로 정의된 것처럼 취급된다.

```cpp title="name_hiding.cpp — 파생 클래스가 베이스의 오버로드를 통째로 가린다"
#include <iostream>
#include <string>

class Logger {
public:
    void log(int code) { std::cout << "코드: " << code << "\n"; }
    void log(const std::string& msg) { std::cout << "메시지: " << msg << "\n"; }
};

class SensorLogger : public Logger {
public:
    void log(double value) { std::cout << "값: " << value << "\n"; }   // 오버로드 추가 의도
};

int main() {
    SensorLogger logger;
    logger.log(3.14);              // 의도대로 동작
    logger.log("lidar 준비됨");     // 컴파일 에러 예상
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra name_hiding.cpp -o name_hiding
name_hiding.cpp: In function 'int main()':
name_hiding.cpp:18:16: error: cannot convert 'const char [16]' to 'double'
   18 |     logger.log("lidar 준비됨");     // 컴파일 에러 예상
      |                ^~~~~~~~~~~~~~
      |                |
      |                const char [16]
name_hiding.cpp:12:21: note:   initializing argument 1 of 'void SensorLogger::log(double)'
```

`SensorLogger`는 `log(double)`만 추가했을 뿐인데, 컴파일러는 `logger.log("lidar 준비됨")`을 `Logger::log(const std::string&)` 후보와 아예 비교조차 하지 않았다 — 오버로드 후보에서 완전히 제외됐다. [1.3 변수, 초기화, 스코프](#/variables)의 이름 가리기(shadowing)가 블록 스코프에서 일어나는 것과 같은 규칙이 클래스 스코프에서도 그대로 적용된다: 안쪽 스코프(`SensorLogger`)의 이름이 바깥 스코프(`Logger`)의 같은 이름을 통째로 덮는다. `using` 선언으로 베이스의 이름을 다시 끌어오면 해결된다.

```cpp title="name_hiding_fixed.cpp — using으로 가려진 오버로드를 되살린다"
#include <iostream>
#include <string>

class Logger {
public:
    void log(int code) { std::cout << "코드: " << code << "\n"; }
    void log(const std::string& msg) { std::cout << "메시지: " << msg << "\n"; }
};

class SensorLogger : public Logger {
public:
    using Logger::log;   // Logger의 오버로드 전체를 다시 보이게 한다
    void log(double value) { std::cout << "값: " << value << "\n"; }
};

int main() {
    SensorLogger logger;
    logger.log(3.14);
    logger.log(404);
    logger.log(std::string("lidar 준비됨"));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra name_hiding_fixed.cpp -o name_hiding_fixed && ./name_hiding_fixed
값: 3.14
코드: 404
메시지: lidar 준비됨
```

`using Logger::log;` 한 줄이 `Logger`의 모든 `log` 오버로드를 `SensorLogger`의 오버로드 집합에 다시 합류시킨다. 이제 세 타입 모두 정상적으로 오버로드 해석이 일어난다.

::: deep 왜 "추가"가 아니라 "가리기"인가
다른 언어의 메서드 오버라이드에 익숙하면 파생 클래스의 새 시그니처가 베이스 오버로드 집합에 그냥 더해질 거라 기대하기 쉽다. C++의 이름 탐색(name lookup)은 스코프 단위로 멈춘다 — 컴파일러는 먼저 `SensorLogger` 스코프에서 `log`라는 이름을 찾고, 하나라도 찾으면 그 스코프에서 탐색을 끝낸다. 베이스 스코프까지 올라가 오버로드 집합을 합치는 규칙 자체가 없다. `using` 선언은 베이스의 이름을 파생 스코프 **안으로 끌어와 선언**함으로써 이 문제를 우회한다.
:::

## 로봇 도메인: Sensor 계층 설계

지금까지의 조각을 로봇 센서 계층 하나로 모은다. `Sensor`는 `private` 데이터와 `protected` 접근자만 내주고(protected의 함정 회피), `LidarSensor`·`ImuSensor`는 public 상속으로 그 인터페이스를 확장한다.

```cpp title="sensor_hierarchy.cpp — Sensor 계층과 슬라이싱의 경계"
#include <iostream>
#include <memory>
#include <string>
#include <vector>

class Sensor {
public:
    explicit Sensor(std::string frame_id) : frame_id_(std::move(frame_id)) {}
    std::string describe() const { return "Sensor(" + frame_id_ + ")"; }   // 아직 virtual이 아니다 -- 3.4의 몫

protected:
    const std::string& frame_id() const { return frame_id_; }   // 파생 클래스는 접근자로만 접근

private:
    std::string frame_id_;
};

class LidarSensor : public Sensor {
public:
    LidarSensor(std::string frame_id, int beam_count)
        : Sensor(std::move(frame_id)), beam_count_(beam_count) {}
    std::string describe() const {
        return "Lidar(" + frame_id() + ", beams=" + std::to_string(beam_count_) + ")";
    }

private:
    int beam_count_;
};

class ImuSensor : public Sensor {
public:
    ImuSensor(std::string frame_id, int hz)
        : Sensor(std::move(frame_id)), hz_(hz) {}
    std::string describe() const {
        return "Imu(" + frame_id() + ", " + std::to_string(hz_) + "Hz)";
    }

private:
    int hz_;
};

int main() {
    // 값으로 담으면 슬라이싱된다 -- LidarSensor/ImuSensor의 멤버가 물리적으로 안 들어간다
    std::vector<Sensor> by_value;
    by_value.push_back(LidarSensor("lidar_front", 16));
    by_value.push_back(ImuSensor("imu_chassis", 200));
    std::cout << "-- vector<Sensor>: 슬라이싱됨 --\n";
    for (const auto& s : by_value) std::cout << "  " << s.describe() << "\n";

    // 포인터로 담으면 힙에 LidarSensor/ImuSensor 크기 그대로 생성되고 잘리지 않는다
    std::vector<std::unique_ptr<Sensor>> by_pointer;
    by_pointer.push_back(std::make_unique<LidarSensor>("lidar_front", 16));
    by_pointer.push_back(std::make_unique<ImuSensor>("imu_chassis", 200));
    std::cout << "-- vector<unique_ptr<Sensor>>: 안 잘림, 그런데 --\n";
    for (const auto& s : by_pointer) std::cout << "  " << s->describe() << "\n";

    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sensor_hierarchy.cpp -o sensor_hierarchy
$ ./sensor_hierarchy
-- vector<Sensor>: 슬라이싱됨 --
  Sensor(lidar_front)
  Sensor(imu_chassis)
-- vector<unique_ptr<Sensor>>: 안 잘림, 그런데 --
  Sensor(lidar_front)
  Sensor(imu_chassis)
```

`vector<Sensor>`는 예상대로 빔 개수와 주파수를 잃는다. `vector<`[`unique_ptr`](#/unique-ptr)`<Sensor>>`로 바꾸면 힙에는 원래 크기 그대로 객체가 만들어지고 잘리지 않는다 — 그런데 출력은 여전히 둘 다 `Sensor(...)`다. `describe()`가 아직 `virtual`이 아니라서 `s->describe()`는 포인터의 **정적 타입**(`Sensor*`)만 보고 `Sensor::describe()`를 부른다. 슬라이싱은 막았지만 다형성은 아직 아니다 — 마지막 조각이 [3.4 가상함수와 vtable](#/virtual-vtable)의 `virtual` 키워드다.

이 패턴은 로봇 SW 스택 전반의 표준 구조다. [10.9 ros2_control과 hardware_interface](#/ros2-control)의 `SystemInterface`도, [11.1 pluginlib와 플러그인 아키텍처](#/pluginlib)가 동적으로 로드하는 클래스도 "베이스 포인터 하나로 여러 파생 타입을 담는다"는 이 구조 위에 서 있다 — 컨테이너에 값이 아니라 포인터를 쓰는 이유가 이 절의 슬라이싱이다.

::: interview 객체 슬라이싱이 뭐고 어떻게 방지하나
답변 뼈대: ① **정의** — 파생 객체를 베이스 클래스의 값(포인터·레퍼런스 아님)으로 다룰 때 파생 부분이 물리적으로 잘려나가는 현상. 컴파일러가 `sizeof(Base)`만큼만 복사해서다. ② **일어나는 지점** — 값 전달, 값 반환, `std::vector<Base>` 같은 값 저장 컨테이너 — 셋 다 "정적 타입이 `Base`인 값 슬롯"이다. ③ **버그가 아니라 정의된 동작이다** — 표준이 베이스 서브오브젝트만 복사하도록 명시해 경고도 없다. ④ **방지법** — 값 대신 포인터(`Base*`, 스마트 포인터)나 레퍼런스(`const Base&`)로 다룬다. 크기가 고정이라 슬라이싱 자체가 성립하지 않는다. ⑤ 후속 질문 "포인터로 바꾸면 다 해결되나?" — "슬라이싱은 막아도 함수가 `virtual`이 아니면 여전히 정적 타입의 함수가 불린다"까지 답하면 3.4와의 연결까지 보여주는 좋은 답이다.
:::

## 요약

- **객체 슬라이싱**: 파생 객체를 베이스 타입의 값으로 다루면 파생 부분이 물리적으로 잘려나간다. `sizeof(Base)`만큼만 복사되기 때문이다(실측: `sizeof(Sensor)=32`, `sizeof(LidarSensor)=40`). 컴파일러는 경고하지 않는다 — 정의된 동작이다.
- 슬라이싱은 **값으로 전달, 값으로 반환, 컨테이너에 값으로 저장** 세 지점에서 일어난다. 공통점은 "정적 타입이 베이스인 값 슬롯"이다.
- **public 상속**만 실전에서 쓴다(is-a 성립). protected/private 상속은 존재만 알아두고, 그 자리엔 컴포지션을 먼저 검토한다.
- 파생 클래스는 멤버 초기화 리스트에서 베이스 생성자를 명시적으로 호출한다. 생성은 베이스가 먼저, 소멸은 베이스가 나중이다.
- **protected 데이터**는 베이스의 내부 표현을 모든 파생 클래스와의 암묵적 계약으로 만든다 — 표현을 바꾸면 파생 클래스가 컴파일은 되지만 조용히 틀린 값을 낸다(실측: cm→m 리팩터링으로 `2.5 m`가 `0.025 m`가 됨). `private` 데이터 + `protected` 접근자 메서드가 더 안전한 대안이다.
- **다중 상속**의 다이아몬드 문제: 같은 베이스를 두 경로로 상속하면 서브오브젝트가 중복되고(`sizeof`가 두 배), 멤버 접근이 모호해진다. `virtual` 상속으로 단일 인스턴스를 강제할 수 있지만 부가 비용(포인터)이 붙는다. 다중 상속은 데이터 없는 순수 인터페이스에만 쓴다.
- 파생 클래스가 베이스와 이름이 같은 함수를 하나라도 선언하면 그 이름의 베이스 오버로드 전체가 가려진다(이름 가리기). `using Base::method;`로 되살린다.

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. `slicing_by_value.cpp`에서 `sizeof(LidarSensor)`가 `sizeof(Sensor)`보다 8바이트 크다. `int beam_count_` 하나인데 왜 4바이트가 아니라 8바이트인지, 그리고 이 크기 차이가 슬라이싱과 무슨 관계인지 설명하라.
2. `protected_after.cpp`가 컴파일 경고 없이 틀린 값(`0.025 m`)을 냈다. `private_plus_accessor.cpp`의 구조가 왜 같은 리팩터링에도 안전한지, `range_meters()` 함수의 역할을 근거로 설명하라.
3. `diamond_virtual_fix.cpp`에서 `LidarSensor`, `ImuSensor` 둘 중 하나만 `virtual` 상속으로 바꾸고 나머지는 일반 상속으로 남기면 `fused.frame_id_`에 접근할 때 모호성 에러가 다시 나는지, 나지 않는지 예측하고 그 이유를 설명하라.
4. (실습) 임의의 베이스/파생 클래스 쌍을 만들어 `std::vector<Base>`에 파생 객체를 `push_back`한 뒤, `sizeof(Base)`·`sizeof(Derived)`를 출력하고 슬라이싱으로 사라진 멤버가 있음을 직접 확인하라.
5. (실습) 4번의 컨테이너를 `std::vector<std::unique_ptr<Base>>`로 바꿔 다시 실행하고, 힙에 저장된 각 객체가 파생 타입 크기 그대로인지(잘리지 않았는지)를 `describe()`가 아니라 저장된 데이터 값을 직접 출력해 확인하라. `g++ -std=c++20 -Wall -Wextra -fsanitize=address`로 빌드해 메모리 에러가 없는지도 확인하라.
:::

::: answer 해설
1. `int`는 4바이트지만 다음 멤버가 없어 구조체 끝이 가장 큰 정렬 요구사항(`std::string`의 8바이트)에 맞춰 패딩된다 — 그래서 8바이트가 늘었다. 슬라이싱은 이 늘어난 바이트가 베이스 타입의 상자엔 아예 없다는 사실 그 자체다 — 크기 차이가 곧 "못 담는 양"이다.
2. `range_meters()`는 `raw_range_meters_`를 읽는 유일한 통로다. `Sensor`가 저장 단위를 어떻게 바꾸든 변환은 이 함수 한 곳에서만 일어나므로, `range_in_meters()`는 항상 "이미 미터로 변환된" 값을 그대로 쓴다. `protected_after.cpp`는 파생 클래스가 원시 데이터를 직접 읽고 자기 나름대로(틀리게) 재해석했다는 게 차이다.
3. 모호성 에러가 다시 난다. `virtual` 상속은 그 경로의 `Sensor` 서브오브젝트를 한 벌로 합치는 장치인데, 한쪽 경로만 `virtual`이고 다른 쪽이 일반 상속이면 그쪽 `Sensor`는 여전히 별도로 존재한다. 다이아몬드의 양쪽 경로가 전부 `virtual`이어야 병합된다.
4. `diamond_sizeof.cpp`나 `slicing_three_points.cpp`의 구조를 재사용하면 된다. `push_back` 후 `sizeof`를 비교하면 파생 타입이 더 크고, 저장된 원소의 멤버 값을 확인하면 파생 전용 멤버가 반영되지 않았다.
5. `vector<unique_ptr<Base>>`로 바꾼 뒤 각 원소가 가리키는 객체의 파생 전용 멤버 값을 출력하면 슬라이싱 없이 원래 값이 남아 있다. `-fsanitize=address` 빌드가 리포트 없이 종료되면 `make_unique`로 만든 객체가 정확히 한 번씩 해제됐다는 뜻이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `diamond_ambiguous.cpp`는 에러 메시지의 `note:` 줄까지 읽고 "왜 두 후보가 나오는지"를 스스로 설명해 보고, `name_hiding.cpp`는 `using` 선언을 빼고 넣고를 반복하며 어떤 오버로드가 보이고 안 보이는지 직접 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [3.4 가상함수와 vtable](#/virtual-vtable) — 이 절의 `sensor_hierarchy.cpp`는 슬라이싱을 막기 위해 포인터를 썼지만, `describe()`가 `virtual`이 아니라서 결국 베이스 버전만 불렀다. 다음 절은 `virtual` 키워드 하나가 포인터 호출을 실제로 어떻게 파생 클래스의 함수로 되돌리는지, 그 내부의 vtable 구조를 위젯과 실측으로 뜯어본다.
