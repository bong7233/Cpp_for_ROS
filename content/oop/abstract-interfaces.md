# 3.5 추상 클래스와 인터페이스 설계

::: lead
[3.4 가상함수와 vtable](#/virtual-vtable)에서 `= 0`을 잠깐 봤다 — 몸체 없는 가상 함수, 그리고 그런 클래스는 직접 만들 수 없다는 것. 이 절은 그 `= 0`을 정면으로 다룬다. 서로 다른 센서(Lidar, IMU, 카메라)를 하나의 인터페이스로 묶고, 파생 클래스만 자기 방식으로 구현하게 만드는 패턴이다. 순수 가상 함수의 문법부터, 데이터 없는 "순수 인터페이스"가 [3.3](#/inheritance)의 다이아몬드 문제를 왜 비껴가는지, 그리고 이 구조가 로봇 SW 스택 전체의 플러그인 아키텍처와 어떻게 이어지는지까지 간다.
:::

## 문제부터: 센서마다 읽는 방식이 다르다

`LidarSensor`는 거리 하나를 `double`로 돌려준다. `ImuSensor`는 롤/피치/요 세 값을 out 파라미터로 채운다. `CameraSensor`는 프레임을 저장한 파일 경로를 문자열로 돌려준다. 셋은 상속 관계가 전혀 없고, 시그니처도 반환 방식도 제각각이다.

```cpp title="problem_no_common_interface.cpp — 타입마다 다른 read 방식, 공통 인터페이스가 없다"
#include <iostream>
#include <string>

class LidarSensor {
public:
    explicit LidarSensor(int beams) : beams_(beams) {}
    double read_range() const { return 2.5; }
    int beams_;
};

class ImuSensor {
public:
    explicit ImuSensor(int hz) : hz_(hz) {}
    void read_orientation(double& roll, double& pitch, double& yaw) const {
        roll = 0.01; pitch = -0.02; yaw = 1.57;
    }
    int hz_;
};

class CameraSensor {
public:
    explicit CameraSensor(int fps) : fps_(fps) {}
    std::string read_frame_path() const { return "/tmp/frame_0001.png"; }
    int fps_;
};

// poll_all()은 각 타입을 하나씩 알아야 한다 -- 타입이 늘 때마다 이 함수도 늘어난다
void poll_all(const LidarSensor& lidar, const ImuSensor& imu, const CameraSensor& cam) {
    std::cout << "lidar range = " << lidar.read_range() << "\n";
    double r, p, y;
    imu.read_orientation(r, p, y);
    std::cout << "imu rpy = " << r << ", " << p << ", " << y << "\n";
    std::cout << "camera frame = " << cam.read_frame_path() << "\n";
}

int main() {
    LidarSensor lidar(16);
    ImuSensor imu(200);
    CameraSensor cam(30);
    poll_all(lidar, imu, cam);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra problem_no_common_interface.cpp -o a.out && ./a.out
lidar range = 2.5
imu rpy = 0.01, -0.02, 1.57
camera frame = /tmp/frame_0001.png
```

당장은 잘 돈다. 문제는 센서가 하나 더 늘 때다 — `ToFSensor`를 추가하면 `poll_all`의 시그니처에 매개변수 하나가 늘고, 이 함수를 부르는 모든 곳을 고쳐야 한다. 새 센서 타입이 생길 때마다 "이걸 쓰는 모든 함수"를 찾아 고치는 구조는 컴파일 단위가 늘어날수록 깨지기 쉽다. 필요한 건 "센서라면 뭐든 `read()`라는 이름으로 부를 수 있다"는 계약이다 — 그 계약을 문법으로 강제하는 것이 순수 가상 함수다.

## 순수 가상 함수와 추상 클래스

`virtual` 뒤에 몸체 대신 `= 0`을 붙이면 **순수 가상 함수**(pure virtual function)가 된다. 이 함수는 정의가 없다 — "이 이름과 시그니처로 뭔가 있어야 한다"는 약속만 있고, 실제 구현은 파생 클래스의 몫으로 넘어간다.

```cpp title="abstract_cannot_instantiate.cpp — 추상 클래스는 인스턴스화할 수 없다"
#include <string>

class Sensor {
public:
    virtual std::string read() const = 0;   // 순수 가상 함수 -- 몸체가 없다
};

int main() {
    Sensor s;   // 추상 클래스를 직접 만들려는 시도
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra abstract_cannot_instantiate.cpp -o a.out
abstract_cannot_instantiate.cpp: In function 'int main()':
abstract_cannot_instantiate.cpp:9:12: error: cannot declare variable 's' to be of abstract type 'Sensor'
    9 |     Sensor s;   // 추상 클래스를 직접 만들려는 시도
      |            ^
abstract_cannot_instantiate.cpp:3:7: note:   because the following virtual functions are pure within 'Sensor':
    3 | class Sensor {
      |       ^~~~~~
abstract_cannot_instantiate.cpp:5:25: note:     'virtual std::string Sensor::read() const'
```

순수 가상 함수를 하나라도 가진 클래스는 **추상 클래스**(abstract class)가 된다. 컴파일러는 그 자리에서 인스턴스화를 거부한다 — 컴파일 타임에 "정의가 없는 함수를 부를 방법이 없다"는 사실을 확정 짓는 것이다. `LidarSensor`처럼 `read()`를 실제로 구현한 파생 클래스만 인스턴스화할 수 있다.

여기서 흔한 오해가 하나 있다. **추상 클래스는 순수 가상 함수만 가진 껍데기가 아니다.** 생성자도, 데이터 멤버도, 몸체가 있는 일반 가상 함수도 그대로 가질 수 있다. 순수 가상 함수가 하나라도 남아 있으면 그 클래스는 여전히 추상이다.

```cpp title="partial_abstract.cpp — 생성자·데이터·비순수 가상 함수를 가진 부분 추상 클래스"
#include <iostream>
#include <string>

// read_raw()만 순수 가상이다 -- 나머지는 전부 완전한 구현을 가진다
class Sensor {
public:
    explicit Sensor(std::string frame_id) : frame_id_(std::move(frame_id)) {}

    virtual double read_raw() const = 0;   // 순수 가상 -- 파생이 반드시 구현

    virtual std::string describe() const {   // 비순수 가상 -- 공통 구현이 있고, 필요하면 재정의 가능
        return "Sensor(" + frame_id_ + ", raw=" + std::to_string(read_raw()) + ")";
    }

    virtual ~Sensor() = default;

protected:
    std::string frame_id_;   // 데이터 멤버를 가진다 -- 순수 인터페이스가 아니다
};

class LidarSensor : public Sensor {
public:
    LidarSensor(std::string frame_id, double range) : Sensor(std::move(frame_id)), range_(range) {}
    double read_raw() const override { return range_; }
private:
    double range_;
};

int main() {
    LidarSensor lidar("lidar_front", 2.5);
    std::cout << lidar.describe() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra partial_abstract.cpp -o a.out && ./a.out
Sensor(lidar_front, raw=2.500000)
```

`Sensor`는 생성자로 `frame_id_`를 받고, `describe()`는 파생 클래스가 몸체를 다시 안 써도 그대로 동작한다. `read_raw()`만 파생에게 강제로 떠넘긴다. 이게 **부분 추상**(partially abstract)이다 — 공통 로직은 베이스가 쥐고, 타입마다 달라야 하는 부분만 순수 가상으로 뚫어 둔다. 뒤에 나올 NVI 패턴이 정확히 이 아이디어 위에 서 있다.

이와 대비되는 것이 **완전 추상**(fully abstract) 클래스다 — 데이터 멤버가 하나도 없이 순수 가상 함수(와 가상 소멸자)만 갖는 클래스. C++에는 다른 언어의 `interface` 같은 전용 키워드가 없다. 완전 추상 클래스를 관례적으로 "인터페이스"라 부를 뿐이고, 다음 절이 그 패턴이다.

## 순수 인터페이스 패턴: 데이터 없는 다형성

`Sensor`에서 데이터 멤버를 전부 걷어내고 순수 가상 함수와 가상 소멸자만 남기면, 이제 이 타입은 "센서라면 반드시 `read()`가 있다"는 계약 그 자체가 된다. `LidarSensor`, `ImuSensor`, `CameraSensor`는 각자 이 계약을 자기 방식대로 채운다.

```cpp title="pure_interface_container.cpp — 순수 인터페이스와 다형적 컨테이너"
#include <iostream>
#include <memory>
#include <string>
#include <vector>

// 순수 인터페이스: 데이터 멤버가 하나도 없다. 순수 가상 함수와 가상 소멸자뿐이다.
class Sensor {
public:
    virtual std::string read() const = 0;
    virtual ~Sensor() = default;
};

class LidarSensor : public Sensor {
public:
    explicit LidarSensor(int beams) : beams_(beams) {}
    std::string read() const override {
        return "lidar range=2.5m (beams=" + std::to_string(beams_) + ")";
    }
private:
    int beams_;
};

class ImuSensor : public Sensor {
public:
    explicit ImuSensor(int hz) : hz_(hz) {}
    std::string read() const override {
        return "imu rpy=(0.01, -0.02, 1.57) (" + std::to_string(hz_) + "Hz)";
    }
private:
    int hz_;
};

class CameraSensor : public Sensor {
public:
    explicit CameraSensor(int fps) : fps_(fps) {}
    std::string read() const override {
        return "camera frame=/tmp/frame_0001.png (" + std::to_string(fps_) + "fps)";
    }
private:
    int fps_;
};

int main() {
    std::vector<std::unique_ptr<Sensor>> sensors;
    sensors.push_back(std::make_unique<LidarSensor>(16));
    sensors.push_back(std::make_unique<ImuSensor>(200));
    sensors.push_back(std::make_unique<CameraSensor>(30));

    for (const auto& s : sensors) {
        std::cout << s->read() << "\n";   // 타입을 하나도 모르고 전부 순회한다
    }

    std::cout << "sizeof(Sensor) = " << sizeof(Sensor) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra pure_interface_container.cpp -o a.out && ./a.out
lidar range=2.5m (beams=16)
imu rpy=(0.01, -0.02, 1.57) (200Hz)
camera frame=/tmp/frame_0001.png (30fps)
sizeof(Sensor) = 8
```

`main`은 `LidarSensor`도 `ImuSensor`도 `CameraSensor`도 모른다 — `Sensor` 하나만 알고, `read()`라는 이름 하나로 세 타입 전부를 순회한다. `poll_all`처럼 타입이 늘 때마다 고쳐야 하는 함수가 사라졌다. `std::vector<std::unique_ptr<Sensor>>`가 그릇이다 — [2.9 unique_ptr](#/unique-ptr)에서 봤듯, 힙에 만든 파생 객체를 `Sensor*`로 담아도 각자의 메모리는 원래 크기 그대로 살아 있다. `vector<Sensor>`로 값 저장했다면 [3.3](#/inheritance)의 슬라이싱이 그대로 재현됐을 자리다.

`sizeof(Sensor) = 8`도 눈여겨볼 값이다. 데이터 멤버가 하나도 없는데 크기가 0이 아니라 8이다 — 가상 함수가 있는 클래스는 vtable을 가리키는 포인터(vptr) 하나를 반드시 갖기 때문이다. [3.4 가상함수와 vtable](#/virtual-vtable)에서 본 그 vptr이 순수 인터페이스에서도 그대로 있다 — 순수 가상 함수도 vtable 안에 자기 슬롯을 하나 차지한다는 뜻이다.

::: deep 순수 가상 함수의 vtable 슬롯은 비어 있지 않다
"몸체가 없다"는 게 "vtable에 자리가 없다"는 뜻은 아니다. `Sensor::read`는 vtable에 슬롯을 하나 갖는다 — 다만 `LidarSensor`처럼 최종 오버라이더가 정해지기 전까지, 그 슬롯이 가리킬 함수가 없을 뿐이다. Itanium ABI(g++가 따르는 표준)에서는 이 빈 슬롯이 `__cxa_pure_virtual`이라는 처리기를 가리킨다 — 실제로 불리면 "pure virtual method called"로 중단시키는 안전장치다. 언제 이게 문제가 되는지 실측으로 보자. `Sensor`의 생성자 안에서 `read()`를 부르면, 그 시점의 동적 타입은 아직 `Sensor`다(파생 부분이 생성되기 전이다) — 즉 이 호출은 `Sensor` 자신의 슬롯을 가리켜야 하는데, 그 슬롯을 채울 `Sensor::read()` 정의가 애초에 없다.

```console
$ g++ -std=c++20 -Wall -Wextra pure_virtual_call_from_ctor.cpp -o a.out
pure_virtual_call_from_ctor.cpp:8:26: warning: pure virtual 'virtual std::string Sensor::read() const' called from constructor
/usr/bin/ld: ...: undefined reference to `Sensor::read[abi:cxx11]() const'
collect2: error: ld returned 1 exit status
```

컴파일러가 경고까지 띄우고, 결국 링크 단계에서 실패한다 — 정의되지 않은 `Sensor::read()`를 링커가 못 찾아서다. 파생 클래스의 오버라이드가 자리 잡기 전에는 그 슬롯을 부를 방법이 없다는 사실이 이렇게 드러난다. 생성자·소멸자 안에서는 순수 가상 함수를 부르지 마라 — 부른다면 그 시점의 동적 타입이 무엇인지부터 다시 따져야 한다.
:::

## NVI 패턴: 비가상 인터페이스로 규칙을 강제한다

지금까지의 `Sensor`는 `read()`를 `public virtual`로 뒀다 — 호출자도 이 함수를 직접 부르고, 파생 클래스도 이 함수를 직접 오버라이드한다. 이 둘을 분리하면 더 강한 걸 얻는다. **NVI 패턴**(Non-Virtual Interface)은 `public`이고 비가상인 함수 하나만 호출자에게 내주고, 그 안에서 `private`(또는 `protected`) 가상 함수를 부른다. 파생 클래스는 그 private 가상 함수만 오버라이드한다 — 사전/사후 조건은 베이스가 항상 강제한다.

```cpp title="nvi_pattern.cpp — 로깅은 베이스가 맡고, 실제 읽기만 파생이 구현한다"
#include <iostream>
#include <string>

class Sensor {
public:
    // 호출자가 보는 것은 이 함수 하나뿐이다 -- 오버라이드 대상이 아니다.
    std::string read() const {
        std::cout << "[log] " << name_ << " 읽기 시작\n";      // 사전 조건: 베이스가 항상 로그를 남긴다
        std::string value = read_impl();                       // 실제 읽기는 파생에게 위임
        std::cout << "[log] " << name_ << " 읽기 종료: " << value << "\n";   // 사후 조건
        return value;
    }

    explicit Sensor(std::string name) : name_(std::move(name)) {}
    virtual ~Sensor() = default;

private:
    virtual std::string read_impl() const = 0;   // 파생 클래스만 이 함수를 구현한다 -- 직접 부를 수 없다
    std::string name_;
};

class LidarSensor : public Sensor {
public:
    explicit LidarSensor(std::string name) : Sensor(std::move(name)) {}
private:
    std::string read_impl() const override { return "2.5m"; }   // 로깅은 신경 쓸 필요가 없다
};

int main() {
    LidarSensor lidar("lidar_front");
    std::string v = lidar.read();
    std::cout << "받은 값: " << v << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra nvi_pattern.cpp -o a.out && ./a.out
[log] lidar_front 읽기 시작
[log] lidar_front 읽기 종료: 2.5m
받은 값: 2.5m
```

`LidarSensor`는 로그를 찍는 코드를 한 줄도 안 썼는데 로그가 찍힌다. `read_impl()`이 `private`이라 `LidarSensor` 밖에서는 아예 부를 수 없기 때문에, 호출자는 항상 `read()`를 거칠 수밖에 없다 — 사전/사후 조건을 우회할 길이 없다. `read_impl`을 밖에서 직접 부르려 하면 이렇게 막힌다.

```console
$ g++ -std=c++20 -Wall -Wextra nvi_private_denied.cpp -o a.out
nvi_private_denied.cpp:22:20: error: 'virtual std::string LidarSensor::read_impl() const' is private within this context
   22 |     lidar.read_impl();
      |     ~~~~~~~~~~~~~~~^~
```

일반 `public virtual` 인터페이스는 파생 클래스가 오버라이드하면서 로깅 호출을 실수로 빼먹을 여지가 있다. NVI는 그 여지를 아예 문법으로 차단한다 — 베이스가 "무조건 이 순서로 일어난다"를 강제하고 싶은 자리(로깅, 락 획득/해제, 입력 검증)에 이 패턴을 쓴다.

## 인터페이스 분리 원칙과 안전한 다중 상속

`Sensor` 인터페이스에 `read()`, `configure()`, `calibrate()`, `save_to_file()`을 전부 몰아넣으면, 저장 기능이 필요 없는 센서까지 `save_to_file()`을 억지로 구현해야 한다. **인터페이스 분리 원칙**(Interface Segregation Principle, ISP)은 거대한 인터페이스 하나 대신, 실제로 쓰이는 만큼만 담은 작은 인터페이스 여러 개로 쪼개라고 말한다.

```cpp title="isp_safe_diamond.cpp — 작은 인터페이스 둘을 다중 상속한다"
#include <iostream>

// 두 인터페이스 다 데이터 멤버가 없다 -- 순수 가상 함수와 가상 소멸자뿐이다.
class Readable {
public:
    virtual double read() const = 0;
    virtual ~Readable() = default;
};

class Configurable {
public:
    virtual void configure(int rate_hz) = 0;
    virtual ~Configurable() = default;
};

class LidarSensor : public Readable, public Configurable {   // 다중 상속
public:
    double read() const override { return 2.5; }
    void configure(int rate_hz) override { rate_hz_ = rate_hz; }
private:
    int rate_hz_ = 10;
};

int main() {
    std::cout << "sizeof(Readable)     = " << sizeof(Readable) << "\n";
    std::cout << "sizeof(Configurable) = " << sizeof(Configurable) << "\n";
    std::cout << "sizeof(LidarSensor)  = " << sizeof(LidarSensor) << "\n";

    LidarSensor lidar;
    lidar.configure(20);
    std::cout << "read() = " << lidar.read() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra isp_safe_diamond.cpp -o a.out && ./a.out
sizeof(Readable)     = 8
sizeof(Configurable) = 8
sizeof(LidarSensor)  = 24
read() = 2.5
```

`LidarSensor`는 `Readable`, `Configurable` 둘을 동시에 상속한다 — [3.3](#/inheritance)이 데이터 있는 베이스의 다중 상속을 경고했던 바로 그 문법이다. 그런데 여기선 아무 문제가 없다. `Readable`, `Configurable`은 공통 조상도, 데이터도 없다 — 각자 vptr 8바이트씩만 차지하고, `LidarSensor`는 그 둘(16바이트) 더하기 자기 `int` 멤버(패딩 포함 8바이트)로 24바이트가 된다. [3.3의 `FusedSensor`](#/inheritance)가 `Sensor` 서브오브젝트 두 벌을 중복해서 만들었던 것과 종류가 다르다 — 애초에 공유하는 베이스가 없으니 중복될 대상 자체가 없다.

공유하는 베이스가 있는 진짜 다이아몬드를 순수 인터페이스로 다시 만들어도 결과는 무해하다.

```cpp title="diamond_pure_interface_test1.cpp — 데이터 없는 다이아몬드: 무해함을 실측"
#include <iostream>
#include <string>

class Sensor {
public:
    virtual std::string frame_id() const = 0;
    virtual ~Sensor() = default;
};

class LidarSensor : public Sensor {};   // frame_id 미구현 -- 여전히 추상
class ImuSensor : public Sensor {};     // frame_id 미구현 -- 여전히 추상

class FusedSensor : public LidarSensor, public ImuSensor {
public:
    std::string frame_id() const override { return "fused_frame"; }   // 최종 오버라이더 하나로 양쪽 경로를 다 채운다
};

int main() {
    std::cout << "sizeof(Sensor)      = " << sizeof(Sensor) << "\n";
    std::cout << "sizeof(FusedSensor) = " << sizeof(FusedSensor) << "\n";

    FusedSensor fused;
    std::cout << "frame_id() = " << fused.frame_id() << "\n";   // 모호하지 않다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra diamond_pure_interface_test1.cpp -o a.out && ./a.out
sizeof(Sensor)      = 8
sizeof(FusedSensor) = 16
frame_id() = fused_frame
```

`FusedSensor`는 `Sensor` 서브오브젝트를 여전히 두 벌 가진다(`sizeof`가 8의 두 배인 16이다) — 다중 상속 자체의 성질은 그대로다. 그런데 [3.3](#/inheritance)과 다르게 `fused.frame_id()`는 모호성 에러 없이 곧장 컴파일되고 실행된다. `Sensor`에 데이터가 없으니 "두 벌의 값 중 어느 게 진짜인가"라는 질문 자체가 성립하지 않고, `FusedSensor`가 최종 오버라이더 하나를 제공하는 순간 컴파일러는 그 하나로 양쪽 경로의 슬롯을 전부 채운다. 만약 `LidarSensor`와 `ImuSensor`가 각자 `frame_id()`를 다르게 구현해 뒀다면 그때는 3.3과 똑같은 모호성 에러가 난다 — 다만 그 에러는 컴파일 타임에 바로 드러나고, `FusedSensor`에 오버라이드 하나만 추가하면 즉시 해결된다. `protected` 데이터가 조용히 틀린 값을 냈던 것과는 실패의 성격 자체가 다르다.

::: tip 실전 선택
데이터 없는 다이아몬드는 안전하지만, 애초에 다이아몬드가 생기지 않는 `Readable`/`Configurable` 방식(서로 무관한 인터페이스를 나열)이 더 간단하다. 인터페이스를 설계할 때는 공통 조상을 만들 필요가 있는지부터 따져라 — 필요 없다면 만들지 않는 쪽이 이해하기 쉽다.
:::

## 가상 소멸자는 필수

[3.4](#/virtual-vtable)에서 베이스 포인터로 파생 객체를 `delete`할 때 가상 소멸자가 없으면 파생 소멸자가 안 불린다는 규칙을 다뤘다. 인터페이스는 거의 항상 베이스 포인터(`Sensor*`, `unique_ptr<Sensor>`)로 다뤄지므로 이 규칙이 특히 더 중요하다. 소멸자를 `virtual`로 안 하면 실제로 무슨 일이 일어나는지 본다.

```cpp title="vdtor_missing.cpp — 비가상 소멸자로 파생 객체를 delete한다"
#include <iostream>

class Sensor {
public:
    ~Sensor() { std::cout << "~Sensor()\n"; }   // virtual이 아니다
};

class LidarSensor : public Sensor {
public:
    LidarSensor() { buffer_ = new double[4]{0, 0, 0, 0}; }
    ~LidarSensor() {
        std::cout << "~LidarSensor() -- buffer 해제\n";
        delete[] buffer_;
    }
private:
    double* buffer_;
};

int main() {
    Sensor* s = new LidarSensor();   // 베이스 포인터로 파생 객체를 가리킨다
    delete s;                        // Sensor::~Sensor()가 virtual이 아니다 -- UB
    std::cout << "delete 완료\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra vdtor_missing.cpp -o a.out && ./a.out
~Sensor()
delete 완료
```

`~LidarSensor()`가 아예 안 불렸다 — `buffer_`를 가리키던 4개짜리 `double` 배열이 그대로 새어 나갔다. `delete s`는 `s`의 **정적 타입**(`Sensor*`)만 보고 `Sensor::~Sensor()`만 부른다. 이 환경(g++ 13.3, 최적화 없음)에서는 조용히 이렇게 나왔지만, 표준은 이 상황을 미정의 동작으로 규정한다 — 다른 컴파일러·다른 최적화 레벨에서는 다르게 망가질 수 있다는 뜻이다. `-fsanitize=address`를 붙이면 이 UB를 실제로 잡아낸다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address vdtor_missing.cpp -o a.out && ./a.out
==...==ERROR: AddressSanitizer: new-delete-type-mismatch on 0x502000000010 in thread T0:
  object passed to delete has wrong type:
  size of the allocated type:   8 bytes;
  size of the deallocated type: 1 bytes.
SUMMARY: AddressSanitizer: new-delete-type-mismatch ...
```

ASan은 "`delete`에 넘긴 타입의 크기(1바이트, `Sensor`)와 실제로 할당된 타입의 크기(8바이트, `LidarSensor`의 `buffer_` 포인터 하나)가 다르다"는 걸 정확히 짚어낸다. 소멸자를 `virtual`로 바꾸면 이 모든 게 사라진다.

```cpp title="vdtor_fixed.cpp — virtual ~Sensor() = default; 관용구"
#include <iostream>

class Sensor {
public:
    virtual ~Sensor() = default;   // 별도 로직이 없어도 virtual + = default
};

class LidarSensor : public Sensor {
public:
    LidarSensor() { buffer_ = new double[4]{0, 0, 0, 0}; }
    ~LidarSensor() override {
        std::cout << "~LidarSensor() -- buffer 해제\n";
        delete[] buffer_;
    }
private:
    double* buffer_;
};

int main() {
    Sensor* s = new LidarSensor();
    delete s;   // 이제 vtable을 통해 ~LidarSensor()부터 정확히 호출된다
    std::cout << "delete 완료\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address vdtor_fixed.cpp -o a.out && ./a.out
~LidarSensor() -- buffer 해제
delete 완료
```

이제 `delete s`는 vtable을 거쳐 `~LidarSensor()`부터 정확히 부르고, 그다음 `~Sensor()`가 이어진다 — [3.2](#/constructors)에서 본 "파생이 먼저 소멸, 베이스가 나중"이 그대로 지켜진다. **순수 인터페이스에는 예외 없이 `virtual ~Sensor() = default;`를 넣는다.** 몸체가 텅 빈 소멸자라도, `virtual`이 빠지면 이 절 전체가 세운 다형적 컨테이너 패턴이 조용히 무너진다.

::: interview 추상 클래스와 인터페이스의 차이, 순수 가상 함수란
답변 뼈대: ① C++에는 `interface` 전용 키워드가 없다 — "인터페이스"는 데이터 멤버 없이 순수 가상 함수와 가상 소멸자만 가진 클래스를 관례적으로 부르는 이름이고, 언어가 강제하는 별도 카테고리가 아니다. ② **추상 클래스**는 순수 가상 함수를 하나 이상 가진 클래스 전체를 가리키는 더 넓은 개념이다 — 생성자·데이터 멤버·비순수 가상 함수를 같이 가질 수 있다("부분 추상"). "인터페이스"는 그중 데이터가 전혀 없는 특수한 경우다. ③ **순수 가상 함수**는 `virtual 반환타입 이름(...) = 0;`으로 선언하고 몸체가 없다 — 파생 클래스가 반드시 오버라이드해야 하며, 이 함수를 가진 클래스는 인스턴스화할 수 없다. ④ 실무 근거를 댈 때는 `sizeof` 실측(데이터 없는 인터페이스는 vptr 하나뿐이라 8바이트)과 NVI 패턴("모든 인터페이스가 `public virtual`은 아니다")을 같이 언급하면 깊이가 드러난다.
:::

## 로봇 도메인: 플러그인 아키텍처의 뼈대

이 절의 구조 — 데이터 없는 순수 인터페이스, `vector<unique_ptr<Interface>>`로 관리되는 다형적 컨테이너, 가상 소멸자 — 는 로봇 SW 스택이 "확장 가능한 플러그인"을 만드는 표준 방식 그 자체다. [11.1 pluginlib와 플러그인 아키텍처](#/pluginlib)가 런타임에 동적으로 로드하는 클래스들은 전부 이런 순수 인터페이스를 상속한 구현체다 — 로더는 인터페이스 타입의 포인터 하나만 받아 들고, 그 뒤에 어떤 구체 타입이 있는지 전혀 몰라도 된다. [11.2 Nav2costmap layer 플러그인](#/nav2-costmap)의 `Layer` 인터페이스도 마찬가지다 — costmap이 레이어를 몇 개 갖든, 어떤 종류든 `updateBounds()`/`updateCosts()`라는 이름으로만 다룬다. 이 절에서 만든 `Sensor` 인터페이스는 장난감 예제가 아니라, 그 두 시스템이 내부에서 실제로 쓰는 것과 동일한 뼈대다.

## 요약

- **순수 가상 함수**(`virtual T f() = 0;`)를 하나라도 가진 클래스는 **추상 클래스**다 — 인스턴스화가 컴파일 타임에 거부된다(실측: `cannot declare variable ... to be of abstract type`).
- 추상 클래스는 순수 가상 함수만의 껍데기가 아니다 — 생성자, 데이터 멤버, 몸체 있는 가상 함수를 같이 가질 수 있다(부분 추상). 데이터가 전혀 없이 순수 가상 함수와 가상 소멸자만 가진 클래스를 관례적으로 "인터페이스"라 부른다(완전 추상). C++에는 `interface` 키워드가 없다.
- **순수 인터페이스 패턴**: `vector<unique_ptr<Interface>>`로 서로 다른 파생 타입을 하나의 컨테이너에 담아 순회한다. 데이터가 없어 `sizeof`는 vptr 하나 크기(8바이트)뿐이다.
- **NVI 패턴**: `public` 비가상 함수가 사전/사후 조건을 강제하고, 그 안에서 `private` 가상 함수를 호출한다. 파생 클래스는 핵심 로직만 오버라이드하며 조건을 우회할 수 없다.
- **인터페이스 분리 원칙**: 거대한 인터페이스 하나 대신 작은 인터페이스 여러 개로 쪼갠다. 공통 조상이 없는 인터페이스들의 다중 상속은 안전하다. 공통 조상이 있는 데이터 없는 다이아몬드도 무해하다(실측: `sizeof(FusedSensor)`가 두 배로 늘 뿐, 최종 오버라이더 하나로 모호성이 사라진다) — [3.3](#/inheritance)의 데이터 다이아몬드와 실패의 성격이 다르다.
- 순수 인터페이스는 거의 항상 베이스 포인터로 다뤄지므로 **`virtual ~Sensor() = default;`가 예외 없이 필요**하다. 빠뜨리면 파생 소멸자가 안 불리는 UB가 생긴다(실측: ASan `new-delete-type-mismatch`).

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. "추상 클래스"와 이 절이 "순수 인터페이스"라 부른 것의 관계를 설명하라. 모든 순수 인터페이스는 추상 클래스인가? 모든 추상 클래스는 순수 인터페이스인가?
2. NVI 패턴에서 `read_impl()`을 `protected`가 아니라 `private`으로 선언했다. 만약 `LidarSensor`를 다시 상속하는 `LidarSensorV2`가 있고 `read_impl()`을 한 번 더 오버라이드하려 한다면, `private`이 이걸 막는지 확인하고 이유를 설명하라.
3. `diamond_pure_interface_test1.cpp`에서 `FusedSensor`가 `frame_id()`를 오버라이드하지 않고, 대신 `LidarSensor`와 `ImuSensor`가 각자 다른 `frame_id()` 구현을 갖고 있다면 `fused.frame_id()` 호출이 컴파일되는지, 안 되는지 예측하고 이유를 설명하라.
4. (실습) `Readable`이라는 순수 인터페이스(순수 가상 함수 하나, 가상 소멸자)를 만들고, 서로 다른 파생 클래스 세 개로 구현하라. `vector<unique_ptr<Readable>>`에 셋을 담고 순회하며 각자의 값을 출력해, 다형적 컨테이너가 실제로 동작함을 확인하라.
5. (실습) NVI 패턴으로 `Logger` 인터페이스를 만들어라 — `public` 비가상 `log(msg)`가 타임스탬프를 찍은 뒤 `private` 가상 `write_impl(msg)`를 부르게 하고, 파생 클래스는 `write_impl`만 구현하게 하라. `g++ -std=c++20 -Wall -Wextra -fsanitize=address`로 빌드해 경고와 새니타이저 리포트가 없는지 확인하라.
:::

::: answer 해설
1. 모든 순수 인터페이스(데이터 없음)는 추상 클래스다 — 순수 가상 함수를 갖고 있기 때문이다. 그러나 역은 성립하지 않는다 — `partial_abstract.cpp`의 `Sensor`처럼 데이터와 비순수 가상 함수를 같이 가진 추상 클래스도 얼마든지 있다. "추상 클래스"가 더 넓은 범주이고, "순수 인터페이스"는 그중 데이터가 전혀 없는 특수 경우다.
2. 막는다. `private`은 "이 클래스 자신에게만" 접근을 허용하고 파생 클래스에게까지 열어주지 않는다 — [3.3](#/inheritance)에서 본 규칙과 같다. `LidarSensorV2`는 `read_impl`을 오버라이드하는 선언 자체는 문법적으로 쓸 수 있어도(가상 함수 오버라이드는 접근 지정자와 무관하게 가능하다), `LidarSensorV2`의 새 코드에서 `read_impl`을 직접 호출하지는 못한다.
3. 컴파일되지 않는다. `LidarSensor`와 `ImuSensor`가 각자 서로 다른 최종 오버라이더를 제공하는 상태에서 `FusedSensor`가 그중 하나를 고르지 않으면, `fused.frame_id()`는 어느 경로의 오버라이드를 불러야 할지 모호해 `diamond_ambiguous.cpp`(3.3)와 같은 종류의 에러가 난다. 데이터가 없다고 해서 함수 이름 자체의 모호성까지 사라지는 건 아니다 — `FusedSensor`가 오버라이드를 다시 제공해야 해소된다.
4. `pure_interface_container.cpp`의 `Sensor`/`LidarSensor`/`ImuSensor`/`CameraSensor` 구조를 그대로 재사용해도 된다. `make_unique`로 만든 세 파생 객체를 담고 순회하며 각자의 `read()` 반환값이 정확히 나오는지 확인한다.
5. `nvi_pattern.cpp`의 구조를 재사용하면 된다 — `log()`가 타임스탬프(또는 고정 문자열이라도)를 찍은 뒤 `write_impl()`을 부르고, 파생 클래스가 `write_impl`만 오버라이드하게 만든다. ASan 빌드가 조용히 종료되면 메모리 문제 없이 정확히 의도한 대로 동작한 것이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `vdtor_missing.cpp`는 일반 빌드와 `-fsanitize=address` 빌드 둘 다 돌려서 "경고 없이 통과하는 코드"와 "새니타이저가 잡아내는 버그"가 같은 코드에서 동시에 성립한다는 걸 직접 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [3.6 연산자 오버로딩](#/operator-overloading) — 인터페이스가 "이 타입이 무엇을 할 수 있는가"를 정의했다면, 다음 절은 "이 타입에 `+`, `==`, `<<` 같은 익숙한 연산자를 써도 되는가"를 다룬다. 언제 오버로딩이 코드를 더 읽기 좋게 만들고, 언제 참아야 하는지 본다.
