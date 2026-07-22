# 3.4 가상함수와 vtable

::: lead
[3.3 상속: is-a의 비용](#/inheritance)의 마지막 코드는 슬라이싱을 피하려고 포인터를 썼는데도 `describe()`가 여전히 `Sensor` 버전만 불렀다. `virtual`이 빠져 있었기 때문이다. [3.2 생성자와 소멸자의 모든 것](#/constructors)에서는 생성자 안에서 가상 함수를 부르면 파생 버전이 아니라 베이스 버전이 불리는 것을 실측만 하고 이유는 미뤘다. 이 절은 두 약속을 한 번에 갚는다. `virtual` 키워드 하나가 포인터 호출의 결과를 실제로 어떻게 뒤바꾸는지, 그 안에 숨은 `vptr`과 `vtable`이라는 두 장치가 정확히 무엇인지 위젯과 실측으로 뜯어본다.
:::

## 문제부터: Base*로 불렀는데 Base 버전이 나왔다

3.3의 `sensor_hierarchy.cpp`를 다시 가져온다. 이번엔 딱 필요한 부분만 남긴다 — `Sensor`를 `unique_ptr`로 가리키고 `describe()`를 부른다.

```cpp title="static_dispatch_before.cpp — Base*로 불렀는데 Base 버전이 나온다"
#include <iostream>
#include <memory>
#include <string>

class Sensor {
public:
    explicit Sensor(std::string frame_id) : frame_id_(std::move(frame_id)) {}
    std::string describe() const { return "Sensor(" + frame_id_ + ")"; }   // virtual 아직 없음

private:
    std::string frame_id_;
};

class LidarSensor : public Sensor {
public:
    LidarSensor(std::string frame_id, int beam_count)
        : Sensor(std::move(frame_id)), beam_count_(beam_count) {}
    std::string describe() const {
        return "Lidar(beams=" + std::to_string(beam_count_) + ")";
    }

private:
    int beam_count_;
};

int main() {
    std::unique_ptr<Sensor> p = std::make_unique<LidarSensor>("lidar_front", 16);
    std::cout << "p->describe() = " << p->describe() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra static_dispatch_before.cpp -o static_dispatch_before
$ ./static_dispatch_before
p->describe() = Sensor(lidar_front)
```

(g++ 13.3 실측, 경고 없음.) `p`가 실제로 가리키는 객체는 `LidarSensor`인데 나온 문자열은 빔 개수가 빠진 `Sensor(lidar_front)`다. 슬라이싱은 안 일어났다 — `p`는 힙에 있는 `LidarSensor` 전체를 그대로 가리킨다. 문제는 딱 하나, `describe()`에 `virtual`이 없다는 것이다. 그 한 단어만 두 군데(베이스 선언, 파생 오버라이드) 고친다.

```cpp title="static_dispatch_virtual_fix.cpp — virtual 하나로 결과가 뒤집힌다"
#include <iostream>
#include <memory>
#include <string>

class Sensor {
public:
    explicit Sensor(std::string frame_id) : frame_id_(std::move(frame_id)) {}
    virtual std::string describe() const { return "Sensor(" + frame_id_ + ")"; }   // virtual 추가
    virtual ~Sensor() = default;

private:
    std::string frame_id_;
};

class LidarSensor : public Sensor {
public:
    LidarSensor(std::string frame_id, int beam_count)
        : Sensor(std::move(frame_id)), beam_count_(beam_count) {}
    std::string describe() const override {
        return "Lidar(beams=" + std::to_string(beam_count_) + ")";
    }

private:
    int beam_count_;
};

int main() {
    std::unique_ptr<Sensor> p = std::make_unique<LidarSensor>("lidar_front", 16);
    std::cout << "p->describe() = " << p->describe() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra static_dispatch_virtual_fix.cpp -o static_dispatch_virtual_fix
$ ./static_dispatch_virtual_fix
p->describe() = Lidar(beams=16)
```

(g++ 13.3 실측.) 호출 코드(`p->describe()`)는 한 글자도 안 바뀌었다. `p`의 선언 타입도 여전히 `Sensor*`(정확히는 `unique_ptr<Sensor>`)다. 바뀐 건 오직 `describe()` 선언 앞의 `virtual` 하나뿐인데, 결과가 `Sensor(...)`에서 `Lidar(beams=16)`으로 완전히 뒤집혔다. 이 절의 나머지 전부는 이 한 단어가 실제로 무엇을 바꾸는지에 대한 답이다.

## 정적 바인딩 vs 동적 바인딩

`describe()`를 부르는 시점에 컴파일러가 "어떤 함수를 실행할지"를 결정하는 방식은 두 가지뿐이다.

- **정적 바인딩(static binding)**: 컴파일 타임에, `p`의 **선언(정적) 타입**만 보고 함수를 확정한다. `virtual`이 없던 첫 번째 코드가 이것이다 — 컴파일러는 `p`가 `Sensor*`라는 것만 알면 충분하다고 보고, `Sensor::describe`의 주소를 호출 지점에 그대로 박아 넣는다. `p`가 실제로 무엇을 가리키는지는 그 결정에 끼어들 틈이 없다.
- **동적 바인딩(dynamic binding, 동적 디스패치)**: 런타임에, `p`가 **실제로 가리키는(동적) 타입**을 보고 함수를 확정한다. `virtual`을 붙인 두 번째 코드가 이것이다 — 호출 지점에는 "이 객체의 실제 타입에 맞는 `describe`를 찾아서 불러라"는 지시만 남고, 정확히 어떤 함수인지는 프로그램이 실행되는 그 순간에 결정된다.

`virtual` 키워드는 정확히 이 전환 스위치다. 없으면 컴파일러가 정적 타입만 믿고 함수를 확정해 버리고, 있으면 "정적 타입은 힌트일 뿐, 진짜 결정은 객체 자신에게 물어봐라"로 바뀐다. `p.get()`이 가리키는 게 `LidarSensor`든 `ImuSensor`든 호출 코드가 똑같이 생겼다는 게 바로 다형성(polymorphism)의 요점이다 — "같은 코드로 여러 타입을 다룬다"는 것은 이 동적 바인딩이 있어야 성립한다. 그런데 그 결정이 런타임에 일어나려면 객체 자신이 "내가 무슨 타입인지"를 어딘가에 들고 있어야 한다. 그 저장소가 다음 절의 주제, `vptr`이다.

## vtable의 정체: 객체에 숨은 포인터 하나

`virtual` 함수를 하나라도 선언한 클래스는 컴파일러가 그 객체 맨 앞에 눈에 보이지 않는 필드를 하나 심는다. `sizeof`로 그 존재를 직접 잡는다.

```cpp title="sizeof_vptr.cpp — virtual 함수가 있으면 sizeof가 8바이트 늘어난다"
#include <iostream>

class NoVirtual {
public:
    void speak() const {}
private:
    double reading_ = 0.0;
};

class WithVirtual {
public:
    virtual void speak() const {}
private:
    double reading_ = 0.0;
};

int main() {
    std::cout << "sizeof(NoVirtual)   = " << sizeof(NoVirtual) << "\n";
    std::cout << "sizeof(WithVirtual) = " << sizeof(WithVirtual) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sizeof_vptr.cpp -o sizeof_vptr && ./sizeof_vptr
sizeof(NoVirtual)   = 8
sizeof(WithVirtual) = 16
```

(g++ 13.3 / x86-64 실측. `double reading_` 하나만 있는 클래스로 골라, `int` 멤버였다면 생기는 정렬 패딩과 뒤섞이지 않게 했다.) 정확히 8바이트, 이 플랫폼에서 포인터 하나의 크기만큼 늘었다. 이 숨은 필드를 **vptr**(virtual table pointer)이라 부른다. `virtual` 함수가 하나라도 있는 클래스는 객체가 생성되는 순간 이 vptr이 채워진다 — **그 클래스가 선언한 모든 가상 함수의 실제 주소를 모아 둔 표, vtable(virtual table)의 주소**로.

여기서 흔히 하는 오해가 하나 있다: vtable이 인스턴스마다 따로 있다고 생각하는 것이다. 실제로는 **vtable은 클래스당 딱 하나**고, 그 클래스의 객체는 몇 개를 만들든 전부 같은 vtable을 가리킨다. 객체마다 다른 건 vptr이 "어느 vtable을 가리키는가"이지, vtable 자체가 아니다.

```cpp title="vptr_per_class.cpp — 서로 다른 두 객체가 같은 vtable을 가리킨다"
#include <cstdio>
#include <cstring>

class Base {
public:
    virtual void speak() const { std::printf("Base::speak\n"); }
    virtual ~Base() = default;
};

class Derived : public Base {
public:
    void speak() const override { std::printf("Derived::speak\n"); }
};

int main() {
    Derived d1, d2;

    void* vptr1;
    void* vptr2;
    std::memcpy(&vptr1, &d1, sizeof(void*));   // 객체 맨 앞 8바이트 = vptr (Itanium C++ ABI)
    std::memcpy(&vptr2, &d2, sizeof(void*));

    std::printf("&d1 = %p, &d2 = %p  (서로 다른 객체)\n", (void*)&d1, (void*)&d2);
    std::printf("d1의 vptr = %p\n", vptr1);
    std::printf("d2의 vptr = %p\n", vptr2);
    std::printf("두 vptr이 같은 값인가? %s\n",
                 vptr1 == vptr2 ? "예 -- vtable은 클래스당 하나" : "아니오");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra vptr_per_class.cpp -o vptr_per_class && ./vptr_per_class
&d1 = 0x7ffd5729fb98, &d2 = 0x7ffd5729fba0  (서로 다른 객체)
d1의 vptr = 0x5580c295ad20
d2의 vptr = 0x5580c295ad20
두 vptr이 같은 값인가? 예 -- vtable은 클래스당 하나
```

::: deep 이 실측은 표준이 아니라 ABI에 기댄다
vptr의 존재도 위치도 표준은 규정하지 않는다 — 전부 **컴파일러가 선택한 구현**이다. 위 결과는 g++/clang이 공유하는 **Itanium C++ ABI**(vptr = 객체의 첫 8바이트)를 반영할 뿐, 다른 컴파일러에서는 위치가 다를 수 있다. 실제 코드에서는 이 방식으로 vptr을 읽지 마라 — 여기서는 "vtable은 클래스당 하나"를 눈으로 보여주기 위한 일회성 실험이다. 주소값 자체는 ASLR로 실행마다 바뀌지만, **두 vptr이 항상 같다는 사실**은 바뀌지 않는다.
:::

포인터 하나(`p`)가 vptr을 거쳐 vtable을 거쳐 실제 함수에 도달하는 경로 전체를 이제 위젯으로 스텝별로 따라간다. 시나리오는 지금까지 본 것과 똑같은 모양이다 — `Base`가 `virtual void speak()`를 선언하고, `Derived`와 `Derived2`가 각자 오버라이드한다.

```cpp title="vtable_scenario.cpp — 위젯이 재현하는 정확한 예제"
#include <iostream>
#include <memory>

class Base {
public:
    virtual void speak() const { std::cout << "Base::speak()\n"; }
    virtual ~Base() = default;
};

class Derived : public Base {
public:
    void speak() const override { std::cout << "Derived::speak()\n"; }
};

class Derived2 : public Base {
public:
    void speak() const override { std::cout << "Derived2::speak()\n"; }
};

int main() {
    auto d = std::make_unique<Derived>();
    Base* p = d.get();
    p->speak();              // 정적 타입은 Base*지만 Derived::speak()가 불린다

    auto d2 = std::make_unique<Derived2>();
    Base* p2 = d2.get();
    p2->speak();             // 같은 호출 코드, 다른 vptr -> 다른 함수

    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra vtable_scenario.cpp -o vtable_scenario && ./vtable_scenario
Derived::speak()
Derived2::speak()
```

(g++ 13.3 실측.) `p->speak()`와 `p2->speak()`는 소스 코드 수준에서 완전히 똑같은 모양(`Base*` 변수 이름 뒤에 `->speak()`)이다. 그런데도 하나는 `Derived::speak()`를, 다른 하나는 `Derived2::speak()`를 부른다 — 코드가 결정하는 게 아니라 **각 객체의 vptr이 결정한다**는 뜻이다.

::: widget vtable-diagram
:::

위젯의 재생 버튼을 누르지 말고 스텝을 하나씩 손으로 넘겨라. `Derived d;`에서 객체 맨 앞에 vptr이 생기는 순간, `Base* p = &d;`에서 정적 타입과 동적 타입이 갈라지는 순간, `p->speak()`가 vptr을 읽고(1단계) vtable의 슬롯을 찾고(2단계) 그 슬롯에 적힌 주소로 점프하는(3단계) 세 걸음을 각각 짚어야 한다. `Derived2`를 추가해 같은 호출 코드가 다른 vptr을 통해 다른 함수로 갈라지는 것까지 확인하고, 마지막 스텝(`delete p`)에서 `~Base()`가 `virtual`이 아니라 `~Derived()`가 스킵되는 경고 표시까지 눈으로 봐라 — 이 마지막 문제는 바로 다음 절에서 정식으로 다룬다.

## override와 final: 오타를 컴파일러가 잡게 한다

시그니처가 베이스와 정확히 일치해야만 오버라이드가 성립한다. 하나라도 다르면 — 타입 하나, `const` 하나만 달라도 — 컴파일러는 그걸 오버라이드가 아니라 **새 이름의 가상 함수**로 받아들인다. `override` 없이 타이핑 실수를 내 본다.

```cpp title="override_typo_no_keyword.cpp — 타입 오타가 조용히 새 함수를 만든다"
#include <iostream>

class Base {
public:
    virtual void update(double dt) const { std::cout << "Base::update\n"; }
    virtual ~Base() = default;
};

class Derived : public Base {
public:
    void update(float dt) const { std::cout << "Derived::update\n"; }   // 오타: double 대신 float
};

int main() {
    Base* p = new Derived();
    p->update(1.0);   // Derived::update가 불릴 거라 기대했지만...
    delete p;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra override_typo_no_keyword.cpp -o override_typo_no_keyword
override_typo_no_keyword.cpp: At global scope:
override_typo_no_keyword.cpp:5:18: warning: 'virtual void Base::update(double) const' was hidden [-Woverloaded-virtual=]
    5 |     virtual void update(double dt) const { std::cout << "Base::update\n"; }
      |                  ^~~~~~
override_typo_no_keyword.cpp:11:10: note:   by 'void Derived::update(float) const'
   11 |     void update(float dt) const { std::cout << "Derived::update\n"; }   // 오타: double 대신 float
      |          ^~~~~~

$ ./override_typo_no_keyword
Base::update
```

(g++ 13.3 실측, `-Wunused-parameter` 경고는 지면상 생략.) `Derived::update(float)`는 매개변수 타입이 다르므로 `Base::update(double)`를 오버라이드하지 않는다. [3.3의 이름 가리기](#/inheritance)처럼 이름 자체는 가려지지만, `p->update(1.0)`은 `p`의 **정적 타입**(`Base*`)으로 오버로드 해석을 하므로 결국 `Base::update(double)`이 뽑히고, 그 가상 함수는 여전히 `Base` 버전을 가리킨다. `-Woverloaded-virtual` 경고가 뜨긴 하지만 빌드 로그의 다른 경고 사이에 묻히기 쉽다 — **컴파일은 통과하고, 경고는 있지만 에러는 아니다.**

::: warn 경고로는 부족하다
`-Woverloaded-virtual`은 "이름이 가려졌다"는 사실만 알려줄 뿐, "오버라이드를 의도했는데 실패했다"는 작성자의 의도까지는 모른다. 오버라이드 의도가 있는 자리에는 반드시 `override`를 붙여서 그 의도 자체를 컴파일러에게 검증받아야 한다.
:::

같은 오타에 `override`만 추가한다.

```cpp title="override_typo_with_keyword.cpp — override가 같은 오타를 컴파일 에러로 바꾼다"
#include <iostream>

class Base {
public:
    virtual void update(double dt) const { std::cout << "Base::update\n"; }
    virtual ~Base() = default;
};

class Derived : public Base {
public:
    void update(float dt) const override { std::cout << "Derived::update\n"; }   // 오타 그대로, override만 추가
};

int main() {
    Base* p = new Derived();
    p->update(1.0);
    delete p;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra override_typo_with_keyword.cpp -o override_typo_with_keyword
override_typo_with_keyword.cpp:11:10: error: 'void Derived::update(float) const' marked 'override', but does not override
   11 |     void update(float dt) const override { std::cout << "Derived::update\n"; }
      |          ^~~~~~
```

(g++ 13.3 실측.) `override`는 컴파일러에게 "이 함수는 베이스의 가상 함수를 오버라이드해야만 한다"는 단언을 건다. 그 단언이 거짓이면 — 시그니처가 베이스의 어떤 가상 함수와도 일치하지 않으면 — 빌드가 그 자리에서 멈춘다. 경고 하나 놓칠 걱정 없이 확실하게 잡힌다. **오버라이드하는 모든 멤버 함수에 `override`를 붙이는 것을 이 책은 예외 없는 관례로 삼는다.**

한 단계 더, 어떤 클래스에서 오버라이드 체인을 완전히 끊고 싶을 때는 `final`을 붙인다.

```cpp title="final_blocks_override.cpp — final 이후의 오버라이드를 컴파일 에러로 막는다"
#include <iostream>

class Base {
public:
    virtual void speak() const { std::cout << "Base::speak\n"; }
    virtual ~Base() = default;
};

class Derived : public Base {
public:
    void speak() const override final { std::cout << "Derived::speak\n"; }   // 여기서 계층을 봉인
};

class Derived2 : public Derived {
public:
    void speak() const override { std::cout << "Derived2::speak\n"; }   // final을 다시 오버라이드 시도
};

int main() { return 0; }
```

```console
$ g++ -std=c++20 -Wall -Wextra final_blocks_override.cpp -o final_blocks_override
final_blocks_override.cpp:16:10: error: virtual function 'virtual void Derived2::speak() const' overriding final function
   16 |     void speak() const override { std::cout << "Derived2::speak\n"; }
      |          ^~~~~
final_blocks_override.cpp:11:10: note: overridden function is 'virtual void Derived::speak() const'
   11 |     void speak() const override final { std::cout << "Derived::speak\n"; }
      |          ^~~~~
```

(g++ 13.3 실측.) `Derived::speak`가 이 계층에서 마지막 오버라이드라는 걸 컴파일러가 강제한다.

::: tip final은 남용하지 마라
`final`이 필요한 자리는 드물다 — "이 이상 확장되면 안 된다"는 설계 결정이 실제로 있을 때만 쓴다(예: 보안이 걸린 검증 로직, 성능 때문에 이 이상 가상 호출 체인을 늘리고 싶지 않은 지점). 확실하지 않으면 그냥 열어 둔다. 나중에 파생 클래스가 필요해졌는데 `final`이 막고 있으면, 그 결정을 원점부터 재검토해야 한다.
:::

## 가상 소멸자: 다형적으로 지우려면 필수다

[3.2](#/constructors)에서 예고한 문제로 돌아간다. 지금까지 예제는 전부 `virtual ~Base() = default;`를 이미 갖고 있었다. 그게 없으면 어떻게 되는지, 실제로 자원을 소유한 파생 클래스로 확인한다.

```cpp title="virtual_dtor_leak.cpp — 비가상 소멸자로 delete하면 파생 소멸자가 스킵된다"
#include <iostream>

class Base {
public:
    virtual void speak() const { std::cout << "Base::speak\n" << std::flush; }
    ~Base() { std::cout << "~Base()\n" << std::flush; }   // virtual 아님

private:
    int tag_ = 0;
};

class Derived : public Base {
public:
    Derived() : buf_(new int[100]) {}
    ~Derived() { std::cout << "~Derived() -- buf_ 해제\n" << std::flush; delete[] buf_; }
    void speak() const override { std::cout << "Derived::speak\n" << std::flush; }

private:
    int* buf_;
};

int main() {
    Base* p = new Derived();
    p->speak();
    delete p;   // ~Base()가 non-virtual -> ~Derived() 스킵, buf_ 누수
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address virtual_dtor_leak.cpp -o virtual_dtor_leak
virtual_dtor_leak.cpp: In function 'int main()':
virtual_dtor_leak.cpp:25:5: warning: deleting object of polymorphic class type 'Base' which has non-virtual destructor might cause undefined behavior [-Wdelete-non-virtual-dtor]
   25 |     delete p;
      |     ^~~~~~~~

$ ./virtual_dtor_leak
Derived::speak
~Base()
=================================================================
==18361==ERROR: AddressSanitizer: new-delete-type-mismatch on 0x503000000040 in thread T0:
  object passed to delete has wrong type:
  size of the allocated type:   24 bytes;
  size of the deallocated type: 16 bytes.
    #0 0x7ff640aff5e8 in operator delete(void*, unsigned long) ...
    #1 0x55fe3ee5d38a in main virtual_dtor_leak.cpp:25
    ... (스택 트레이스 생략)
SUMMARY: AddressSanitizer: new-delete-type-mismatch ... in operator delete(void*, unsigned long)
==18361==ABORTING
```

(g++ 13.3 / `-fsanitize=address` 실측. 스택 트레이스는 지면상 생략했다.) 컴파일 단계에서 이미 `-Wdelete-non-virtual-dtor`가 정확히 경고한다 — "다형적인 클래스인데 소멸자가 비가상이면 UB일 수 있다." 실행 결과가 그걸 증명한다: `speak()`는 `Derived::speak`를 정상 호출했는데 `delete p`가 부른 소멸자는 `~Base()` 하나뿐이다 — `~Derived() -- buf_ 해제` 줄 자체가 안 찍혔다. `delete`는 `p`의 **정적 타입**(`Base*`)만 보고 소멸자를 부르는데, `~Base()`가 `virtual`이 아니라서 여기서도 정적 바인딩이 적용된 것이다. AddressSanitizer는 "`new`로 24바이트(`Derived` 전체)를 할당했는데 `delete`는 16바이트(`Base`만)로 해제하려 한다"는 크기 불일치까지 즉시 잡아 중단시켰다 — `buf_`가 가리키던 배열은 해제될 기회조차 얻지 못하고 누수됐다.

소멸자 앞에 `virtual` 하나만 더한다.

```cpp title="virtual_dtor_fixed.cpp — virtual 소멸자면 파생 소멸자부터 순서대로 불린다"
#include <iostream>

class Base {
public:
    virtual void speak() const { std::cout << "Base::speak\n" << std::flush; }
    virtual ~Base() { std::cout << "~Base()\n" << std::flush; }   // virtual 추가

private:
    int tag_ = 0;
};

class Derived : public Base {
public:
    Derived() : buf_(new int[100]) {}
    ~Derived() { std::cout << "~Derived() -- buf_ 해제\n" << std::flush; delete[] buf_; }
    void speak() const override { std::cout << "Derived::speak\n" << std::flush; }

private:
    int* buf_;
};

int main() {
    Base* p = new Derived();
    p->speak();
    delete p;   // ~Base()가 virtual -> ~Derived()부터 순서대로 호출
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address virtual_dtor_fixed.cpp -o virtual_dtor_fixed
$ ./virtual_dtor_fixed
Derived::speak
~Derived() -- buf_ 해제
~Base()
```

(g++ 13.3 / `-fsanitize=address` 실측, 리포트 없음.) `~Derived()`가 먼저(자기 자원을 정리하고) 실행되고, [3.2](#/constructors)에서 확인한 규칙대로 `~Base()`가 그 뒤를 잇는다. `buf_`는 정확히 해제됐고 ASan은 조용하다.

::: danger 다형적으로 삭제될 가능성이 있으면 가상 소멸자는 선택이 아니다
"베이스 포인터로 파생 객체를 가리키다 `delete`할 일이 있는가"가 기준이다. 답이 "그렇다"거나 "확실치 않다"면 소멸자를 `virtual`로 선언한다. 이미 가상 함수를 하나라도 가진 클래스(다형적으로 쓰일 걸 전제한 클래스)는 대부분 이 기준에 걸린다 — 그래서 실전 관례는 더 단순하다: **가상 함수가 하나라도 있는 클래스는 소멸자도 무조건 `virtual`로 선언한다.** [2.9 unique_ptr](#/unique-ptr)의 `unique_ptr<Base>`로 파생 객체를 담는 모든 코드가 이 규칙에 의존한다.
:::

## 순수 가상 함수 맛보기

`virtual` 함수에 몸체 대신 `= 0`을 붙이면 "이 함수는 파생 클래스가 반드시 구현해야 한다"는 뜻이 된다. 이런 함수를 하나라도 가진 클래스를 **순수 가상 함수(pure virtual function)**를 가진 클래스, 즉 **추상 클래스**라 부른다.

```cpp title="pure_virtual_no_instance.cpp — 순수 가상 함수가 있으면 인스턴스화가 막힌다"
#include <iostream>

class SensorInterface {
public:
    virtual void speak() const = 0;   // 순수 가상 함수 -- 몸체가 없다
    virtual ~SensorInterface() = default;
};

int main() {
    SensorInterface s;   // 에러: 추상 클래스는 인스턴스화할 수 없다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra pure_virtual_no_instance.cpp -o pure_virtual_no_instance
pure_virtual_no_instance.cpp: In function 'int main()':
pure_virtual_no_instance.cpp:10:21: error: cannot declare variable 's' to be of abstract type 'SensorInterface'
   10 |     SensorInterface s;
      |                     ^
pure_virtual_no_instance.cpp:3:7: note:   because the following virtual functions are pure within 'SensorInterface':
    3 | class SensorInterface {
      |       ^~~~~~~~~~~~~~~
pure_virtual_no_instance.cpp:5:18: note:     'virtual void SensorInterface::speak() const'
    5 |     virtual void speak() const = 0;
      |                  ^~~~~
```

(g++ 13.3 실측.) `SensorInterface`는 `speak()`의 실제 몸체가 없으니 그 자체로는 완전한 타입이 아니다 — 컴파일러가 이 사실을 인스턴스화 시점에 강제로 확인시킨다. 이 문법이 정확히 "구현은 없이 인터페이스만 강제한다"는 설계 도구가 되는 이유, `= 0`가 vtable에서는 어떤 형태로 나타나는지, 그리고 이 패턴 위에서 안전한 다형적 인터페이스를 짜는 법(NVI 패턴 포함)은 [3.5 추상 클래스와 인터페이스 설계](#/abstract-interfaces)에서 정식으로 다룬다.

## vtable 조회의 비용

동적 디스패치는 공짜가 아니다. 일반 함수 호출은 컴파일 타임에 주소가 확정돼 컴파일러가 그 호출을 인라인으로 펼칠 수도 있지만, 가상 함수 호출은 "vptr을 읽고 → vtable의 슬롯을 읽고 → 그 주소로 점프"하는 간접 호출이라 **인라인이 원천적으로 불가능**하다. 이 비용을 실측한다. 콜 사이트 하나가 매번 다른 동적 타입(`Derived`와 `Derived2`를 번갈아)을 가리키게 해서, CPU의 분기 예측기가 다음 호출 대상을 예측하지 못하게 만든다.

```cpp title="vtable_cost_bench.cpp — 가상 호출과 일반 호출의 실측 비교"
#include <chrono>
#include <cstdio>
#include <memory>
#include <vector>

class Base {
public:
    virtual int compute(int x) const { return x * 3 + 1; }
    virtual ~Base() = default;
};
class Derived : public Base {
public:
    int compute(int x) const override { return x * 3 + 2; }
};
class Derived2 : public Base {
public:
    int compute(int x) const override { return x * 3 + 3; }
};

struct Plain {   // 가상 함수 없음 -- 인라인 가능
    int compute(int x) const { return x * 3 + 1; }
};

int main() {
    const long N = 100'000'000L;
    volatile int sink = 0;

    // 콜 사이트 하나가 매번 다른 동적 타입을 가리키게 한다 -- 분기 예측 실패를 유도
    std::vector<std::unique_ptr<Base>> objs;
    for (long i = 0; i < 64; ++i) {
        if (i % 2 == 0) objs.push_back(std::make_unique<Derived>());
        else objs.push_back(std::make_unique<Derived2>());
    }

    {
        auto t0 = std::chrono::steady_clock::now();
        int acc = 1;
        for (long i = 0; i < N; ++i) acc = objs[i % 64]->compute(acc) & 0xff;
        auto t1 = std::chrono::steady_clock::now();
        sink = acc;
        double ns = std::chrono::duration<double, std::nano>(t1 - t0).count();
        std::printf("가상 함수(호출마다 다른 타입): %.0f ms 총, %.3f ns/call\n", ns / 1e6, ns / N);
    }
    {
        Plain p;
        auto t0 = std::chrono::steady_clock::now();
        int acc = 1;
        for (long i = 0; i < N; ++i) acc = p.compute(acc) & 0xff;
        auto t1 = std::chrono::steady_clock::now();
        sink = acc;
        double ns = std::chrono::duration<double, std::nano>(t1 - t0).count();
        std::printf("일반 함수 호출: %.0f ms 총, %.3f ns/call\n", ns / 1e6, ns / N);
    }
    (void)sink;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 vtable_cost_bench.cpp -o vtable_cost_bench
$ ./vtable_cost_bench
가상 함수(호출마다 다른 타입): 129 ms 총, 1.294 ns/call
일반 함수 호출: 62 ms 총, 0.617 ns/call
```

(g++ 13.3 / `-O2` / Linux x86-64 실측, 3회 반복에서 1.2~1.3 ns 대 0.6 ns 범위로 일관됐다. 절대값은 CPU마다 다르지만 이 환경의 **약 2배** 차이는 반복 재현됐다.) `Plain::compute`는 어셈블리에서 함수 호출 자체가 사라지고 산술 명령 몇 개로 완전히 인라인됐다 — 가상 호출 쪽은 매 반복 진짜 간접 호출(`call *reg`)이 남는다. 콜 사이트가 한 타입으로 고정돼 분기 예측이 항상 적중하면 이 차이는 실측상 거의 사라진다 — **비용의 실체는 간접 점프 자체보다 "인라인 기회의 상실"과 "분기 예측 실패 가능성"에 있다.**

::: perf 로봇 제어 루프에서 다형성을 쓸 때 고려할 것
콜 사이트 하나가 실행 내내 같은 구체 타입만 가리킨다면(특정 `MotorDriver` 구현 하나를 고정해 쓰는 경우) 가상 호출 비용은 무시해도 되는 수준이다. 문제는 **콜 사이트 하나가 여러 구체 타입을 매번 바꿔가며 부를 때**(플러그인처럼 런타임에 타입이 섞이는 구조)다. 어디가 실제로 느린지는 추측이 아니라 [8.1 프로파일링](#/profiling)으로 확인하고, 컴파일러가 만드는 코드를 읽는 법은 [8.3 컴파일러 최적화와 코드 생성](#/codegen)에서 이어간다.
:::

## 로봇 도메인: 인터페이스 기반 플러그인의 뼈대

[3.3](#/inheritance)이 슬라이싱을 피하려고 포인터를 쓴 이유와, 이 절이 실측한 vtable 메커니즘을 합치면 로봇 SW 스택 전체가 쓰는 표준 패턴이 나온다: **베이스 클래스가 순수 가상 함수로 인터페이스만 선언하고, 여러 구현체가 그 인터페이스를 오버라이드하고, 코드는 베이스 포인터 하나만 들고 다니며 어떤 구현체가 뒤에 있는지는 신경 쓰지 않는다.**

[11.1 pluginlib와 플러그인 아키텍처](#/pluginlib)가 런타임에 동적으로 로드하는 클래스, [11.2 Nav2 costmap layer 플러그인](#/nav2-costmap)의 각 레이어 구현체가 전부 이 뼈대 위에 서 있다 — costmap이 `CostmapLayer*` 하나로 지형 레이어든 장애물 레이어든 똑같이 다루는 것도, Nav2가 `.so`를 런타임에 골라 끼워 넣는 것도 "정적 타입은 고정, 동적 타입은 vptr이 결정한다"는 이 메커니즘 그대로다. 인터페이스를 실제로 설계하는 법은 다음 절의 몫이다.

::: interview vtable이 뭐고 가상함수 호출이 실제로 어떻게 일어나는가
답변 뼈대: ① **정적 vs 동적 바인딩** — `virtual`이 없으면 컴파일 타임에 포인터의 정적 타입만으로 호출할 함수가 확정된다. `virtual`이 있으면 런타임에 객체의 실제 타입을 보고 확정된다. ② **vptr** — 가상 함수가 하나라도 있는 클래스의 객체는 맨 앞에 숨은 포인터(vptr)를 갖고, 생성 시점에 그 클래스의 vtable 주소로 채워진다(`sizeof` 증가로 실측 가능). ③ **vtable** — 그 클래스의 가상 함수 주소를 모은 표. **인스턴스마다가 아니라 클래스당 하나**다. ④ **호출 경로** — `p->f()`는 vptr을 읽고, vtable에서 `f`의 슬롯을 찾고, 그 주소로 점프한다 — 이 세 단계 간접 호출이 정적 바인딩의 직접 호출과 다른 점이다. ⑤ 후속 질문 "그럼 비용은?" — 인라인 불가와 간접 점프가 핵심이며, 콜 사이트가 예측 가능한 단일 타입만 부르면 비용은 실측상 거의 사라지고 여러 타입이 섞이면 눈에 띄게 커진다.
:::

## 요약

- **정적 바인딩**(virtual 없음)은 컴파일 타임에 포인터의 정적 타입만으로 호출할 함수를 확정한다. **동적 바인딩**(virtual 있음)은 런타임에 객체의 실제 타입을 보고 확정한다 — `virtual` 하나가 이 전환 스위치다(실측: `Sensor(lidar_front)` → `Lidar(beams=16)`).
- 가상 함수가 있는 클래스는 객체 맨 앞에 **vptr**이 생긴다(실측: `sizeof`가 이 환경에서 8바이트 증가). vptr은 그 클래스의 **vtable**(가상 함수 주소표)을 가리키고, vtable은 **클래스당 하나**다(실측: 서로 다른 두 객체의 vptr 값이 같음).
- 호출 `p->f()`는 vptr을 읽고, vtable에서 `f`의 슬롯을 찾고, 그 주소로 점프하는 세 단계를 거친다 — 위젯의 스텝이 이 경로 그대로다.
- **override**는 시그니처 불일치를 컴파일 에러로 잡는다. 없으면 오버라이드 실패가 조용한 새 함수 선언으로 처리되고 `-Wall -Wextra`조차 경고 하나로만 남는다(실측: `Base::update`가 잘못 불림). **final**은 그 이후의 오버라이드를 봉인한다.
- **가상 소멸자가 없는 클래스를 베이스 포인터로 delete하면 파생 소멸자가 스킵된다** — 다형적으로 삭제될 가능성이 있으면 소멸자를 반드시 `virtual`로 선언한다(실측: ASan이 `new-delete-type-mismatch`로 즉시 잡아냄).
- **순수 가상 함수**(`= 0`)를 가진 클래스는 인스턴스화할 수 없다 — 추상 클래스와 인터페이스 설계는 [3.5](#/abstract-interfaces)에서 이어간다.
- 가상 호출은 인라인 불가능한 간접 호출이다. 콜 사이트가 단일 타입을 예측 가능하게 부르면 비용은 실측상 거의 사라지고, 여러 타입이 섞이면 이 환경에서 약 2배까지 벌어졌다.
- `pluginlib`, Nav2의 costmap layer 전부 "베이스 포인터 + 순수 가상 인터페이스" 패턴이다.

::: quiz 연습문제
1~2번은 개념, 3번은 예측, 4~5번은 실습(코드 작성형)이다.

1. `static_dispatch_before.cpp`와 `static_dispatch_virtual_fix.cpp`는 `main`의 호출 코드가 완전히 동일한데 출력이 다르다. 정적 바인딩과 동적 바인딩의 정의를 근거로 왜 그런지 설명하라.
2. `vptr_per_class.cpp`에서 `d1`과 `d2`의 주소는 다른데 vptr 값은 같다. 이 결과가 "vtable은 인스턴스마다가 아니라 클래스당 하나"라는 주장의 증거가 되는 이유를 설명하라.
3. `final_blocks_override.cpp`에서 `Derived::speak`의 `final`을 지우고 `override`만 남기면(즉 `void speak() const override { ... }`), `Derived2`의 오버라이드가 여전히 에러가 나는지 예측하고 이유를 설명하라.
4. (실습) 임의의 `Base`/`Derived` 쌍에서 가상 함수 하나를 오버라이드하되 일부러 매개변수 타입을 다르게 적어라(`override` 없이). `-Wall -Wextra`로 컴파일해 `-Woverloaded-virtual` 경고가 뜨는지, `Base*`로 호출했을 때 어느 버전이 불리는지 직접 확인하라. 그다음 `override`를 붙여 같은 실수가 컴파일 에러가 되는 것도 확인하라.
5. (실습) `virtual_dtor_leak.cpp`의 `Base` 소멸자에서 `virtual`을 빼고(원래 예제 그대로) `-fsanitize=address`로 빌드·실행해 `new-delete-type-mismatch` 리포트를 직접 재현하라. 그다음 `virtual`을 다시 붙여 같은 빌드가 리포트 없이 깨끗하게 끝나는 것까지 확인하라. 성공 기준: 두 버전의 ASan 출력 차이(에러 유무)를 네 눈으로 직접 봤는가.
:::

::: answer 해설
1. 첫 코드는 `describe()`에 `virtual`이 없어 정적 바인딩이 적용된다 — 컴파일러가 `p`의 정적 타입(`Sensor*`)만 보고 `Sensor::describe`를 고정한다. 두 번째 코드는 `virtual`이 있어 동적 바인딩이 적용된다 — 런타임에 `p`가 실제로 가리키는 `LidarSensor`의 vptr을 따라간다. 호출 코드는 같아도 결정 시점과 근거가 다르다.
2. vtable이 인스턴스마다 따로 있었다면 서로 다른 객체인 `d1`, `d2`의 vptr도 서로 다른 값이어야 맞다. 실측은 정반대로 같은 vptr 값을 보였다 — 두 vptr이 **같은 하나의 vtable**을 가리킨다는 뜻이고, 그래서 "vtable은 클래스당 하나"의 직접적인 증거가 된다.
3. `final`을 지우면 에러가 사라진다. `Derived2::speak() const override`는 이제 봉인되지 않은 `Derived::speak`를 정상적으로 오버라이드하는 유효한 코드이기 때문이다 — 에러는 `final`이 있을 때만 나고, 지우면 정상 컴파일된다.
4. 오버라이드 의도의 함수가 새 함수로 취급돼 `-Woverloaded-virtual`이 뜨고, `Base*`로 호출하면 베이스 버전이 불린다. `override`를 붙이면 `error: ... marked 'override', but does not override`로 즉시 실패한다.
5. `virtual` 없는 버전은 `new-delete-type-mismatch` 리포트와 `ABORTING`으로 끝나고 `~Derived()`의 해제 로그가 안 찍힌다. `virtual`을 붙이면 `~Derived()` → `~Base()` 순서로 로그가 찍히고 ASan은 조용하다.
:::

이 절의 코드는 전부 직접 쳐라. `vptr_per_class.cpp`는 `Derived` 인스턴스를 서너 개로 늘려 vptr이 몇 개를 만들어도 하나로 고정되는지 확인하고, `vtable_cost_bench.cpp`는 `objs[i % 64]` 대신 `objs[0]`으로 바꿔 콜 사이트가 단일 타입일 때 시간 차이가 어떻게 줄어드는지 재보라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, 성능 측정은 `-O2`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [3.5 추상 클래스와 인터페이스 설계](#/abstract-interfaces) — 이 절은 순수 가상 함수가 인스턴스화를 막는다는 것만 확인했다. 다음 절은 그 순수 가상 함수로 실제 인터페이스를 설계하는 법 — NVI 패턴, 인터페이스와 구현의 분리, 플러그인 구조의 뼈대를 실제 코드로 짠다.
