# 2.6 복사 시맨틱

::: lead
[2.4 new/delete와 동적 할당의 비용](#/dynamic-alloc)에서 힙에 블록을 하나 잡는 법을 봤고, [2.5 RAII](#/raii)에서 그 블록의 수명을 소멸자에게 맡기는 법을 봤다. 그런데 소멸자가 자원을 확실히 해제한다는 사실 자체가 새 함정을 하나 판다 — 그 객체를 **복사**하면, 원본과 복사본이 같은 자원을 향해 서 있다가 둘 다 소멸자에서 그 자원을 해제하려 든다. C++은 이 상황에서 아무것도 막아 주지 않는다. `=`를 쓰면 컴파일러가 조용히 만들어 둔 복사 생성자가 그대로 실행되고, 그 복사 생성자는 기본적으로 **멤버를 있는 그대로 복사**한다. 포인터 멤버라면 포인터가 가리키는 대상이 아니라 주소 값 자체가 복사된다. 이 절은 그 조용한 기본값이 실제로 무엇을 깨뜨리는지 이중 해제로 먼저 확인한 뒤, 언제는 그 기본값이 정확히 옳고 언제는 직접 고쳐 써야 하는지 가른다.
:::

## 복사하면 벌어지는 일: 이중 해제 실측

힙에 정수 배열을 들고 있는 클래스를 하나 만든다. 생성자가 `new[]`로 버퍼를 잡고, 소멸자가 `delete[]`로 돌려준다 — [2.5](#/raii)의 RAII 그대로다.

```cpp title="shallow_copy.cpp — 복사 생성자를 따로 안 썼다"
#include <iostream>

class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) {
        for (std::size_t i = 0; i < n; ++i) data_[i] = static_cast<int>(i);
    }
    ~Buffer() { delete[] data_; }

    std::size_t size_;
    int* data_;
};

int main() {
    Buffer a(5);
    std::cout << "a.data_ = " << a.data_ << "\n";
    {
        Buffer b = a;   // 복사 생성자를 안 썼는데 컴파일은 된다
        std::cout << "b.data_ = " << b.data_ << "  (a.data_와 같다)\n";
    }   // b가 여기서 소멸하며 delete[] data_ 실행
    std::cout << "a.data_[0] = " << a.data_[0] << "  (b가 이미 지운 메모리를 읽는다)\n";
    return 0;
}   // a가 여기서 소멸하며 delete[] data_ 실행 -- 같은 메모리를 두 번째로 delete
```

이 클래스에는 복사 생성자를 선언한 줄이 없다. 그런데 `Buffer b = a;`는 경고 하나 없이 컴파일된다.

```console
$ g++ -std=c++20 -Wall -Wextra shallow_copy.cpp -o shallow_copy
$ ./shallow_copy
a.data_ = 0x5599c768f2b0
b.data_ = 0x5599c768f2b0  (a.data_와 같다)
a.data_[0] = 1503426191  (b가 이미 지운 메모리를 읽는다)
free(): double free detected in tcache 2
```

`b.data_`가 `a.data_`와 **완전히 같은 주소**로 찍힌다. 클래스를 선언한 사람이 아무것도 안 썼는데도, 컴파일러가 눈에 안 보이는 복사 생성자를 하나 만들어 뒀고 그게 `data_` 멤버를 있는 그대로 복사했다는 뜻이다. `b`가 블록을 빠져나가며 그 주소를 `delete[]`하고, 프로그램이 끝나며 `a`가 같은 주소를 또 `delete[]`한다 — glibc의 `free(): double free detected`가 그 순간을 정확히 잡는다. ASan을 붙이면 이중 해제 이전에 이미 벌어진 더 위험한 문제, 즉 해제된 메모리를 읽는 순간을 잡는다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address shallow_copy.cpp -o shallow_copy_asan
$ ./shallow_copy_asan
a.data_ = 0x503000000040
b.data_ = 0x503000000040  (a.data_와 같다)
==24243==ERROR: AddressSanitizer: heap-use-after-free on address 0x503000000040
READ of size 4 at 0x503000000040 thread T0
    #0 0x... in main shallow_copy.cpp:21
freed by thread T0 here:
    #0 0x... in operator delete[](void*)
    #1 0x... in Buffer::~Buffer() shallow_copy.cpp:8
    #2 0x... in main shallow_copy.cpp:20
previously allocated by thread T0 here:
    #0 0x... in operator new[](unsigned long)
    #1 0x... in Buffer::Buffer(unsigned long) shallow_copy.cpp:5
    #2 0x... in main shallow_copy.cpp:15
SUMMARY: AddressSanitizer: heap-use-after-free
```

진단명은 `heap-use-after-free`다. `a.data_[0]`을 읽은 21번째 줄이 원흉이 아니라 증상이다 — 진짜 원인은 15번째 줄에서 만든 버퍼를 8번째 줄(`b`의 소멸자)이 이미 지웠는데, 그 사실을 `a`가 전혀 모른다는 것이다. **`a`와 `b`는 서로 다른 객체인데 `data_` 포인터만은 같은 주소를 들고 있다.** 이 절 전체가 이 한 줄을 바로잡는 이야기다.

::: danger 경고 없이 컴파일된다는 것 자체가 함정이다
`-Wall -Wextra`를 켜도 `shallow_copy.cpp`는 아무 경고가 없다. 컴파일러 입장에서는 규칙대로 복사 생성자를 만들어 준 것뿐이라 잘못한 게 없다. 문제는 그 규칙(멤버별 복사)이 이 클래스에는 안 맞는다는 것인데, 그 판단은 컴파일러가 못 한다 — `int* data_`가 "이 객체가 소유한 자원"인지 "그냥 어딘가를 가리키는 주소"인지는 타입 정보만으로는 구분이 안 되기 때문이다. 그 구분은 클래스를 쓰는 사람의 몫이다.
:::

## 컴파일러가 공짜로 만들어 주는 것: 멤버별 복사

방금 본 버그의 이름은 **얕은 복사**(shallow copy)다. 그런데 이 이름이 가리키는 메커니즘 자체는 버그가 아니다 — 컴파일러가 만든 암묵적 복사 생성자와 암묵적 복사 대입 연산자는 정확히 하나의 규칙만 따른다. **멤버를 하나씩, 각 멤버의 복사 생성자로 복사한다**(멤버별 복사, memberwise copy). `int`, `double`처럼 원시 타입 멤버는 값을 그대로 복사하고, `std::string`처럼 스스로 복사 생성자를 가진 멤버는 그 타입의 복사 생성자가 알아서 불린다. 문제는 `int*`도 원시 타입이라 "그대로 복사"의 대상이라는 것 — 복사되는 건 주소 값이지, 그 주소가 가리키는 5개의 `int`가 아니다.

이 규칙이 정확히 옳은 경우를 먼저 확인한다. 소유하는 포인터가 없고, 멤버 전부가 값 타입이거나 스스로 복사를 올바르게 구현한 타입이면 멤버별 복사는 그 자체로 완전한 깊은 복사다.

```cpp title="pod_copy.cpp — 소유 포인터가 없으면 암묵적 복사로 충분하다"
#include <iostream>
#include <string>

struct RobotPose {
    double x, y, theta;
    std::string frame_id;
};

int main() {
    RobotPose a{1.0, 2.0, 0.5, "odom"};
    RobotPose b = a;   // 암묵적 복사 생성자 -- 멤버별 복사

    b.x = 99.0;
    b.frame_id = "map";

    std::cout << "a: x=" << a.x << " frame_id=" << a.frame_id << "\n";
    std::cout << "b: x=" << b.x << " frame_id=" << b.frame_id << "\n";
    std::cout << "&a.frame_id = " << static_cast<const void*>(&a.frame_id) << "\n";
    std::cout << "&b.frame_id = " << static_cast<const void*>(&b.frame_id) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra pod_copy.cpp -o pod_copy
$ ./pod_copy
a: x=1 frame_id=odom
b: x=99 frame_id=map
&a.frame_id = 0x7ffc6aba7198
&b.frame_id = 0x7ffc6aba71d8
```

`b.x`와 `b.frame_id`를 바꿔도 `a`는 멀쩡하다. `&a.frame_id`와 `&b.frame_id`가 다른 주소라는 것도 실측으로 확인된다 — `std::string`은 자기 자신이 복사 생성자를 제대로 구현해 둔 타입이라, `RobotPose`가 아무 복사 로직도 안 썼는데도 그 안의 문자열까지 올바르게 독립적으로 복사됐다. **멤버별 복사가 위험해지는 유일한 지점은 "소유하는 원시 포인터"가 섞여 있을 때다.** `RobotPose`에는 그게 없었고, `Buffer`에는 있었다 — 두 실측의 차이가 그 경계선 전부다.

## 깊은 복사로 고치기

`Buffer`처럼 원시 포인터로 자원을 직접 소유하는 클래스는 복사 생성자와 복사 대입 연산자를 **직접 써야 한다.** 규칙은 하나다 — 포인터가 가리키는 대상을 새로 만들어서 내용을 옮기고, 절대 주소만 베끼지 않는다.

```cpp title="deep_copy.cpp — 직접 쓴 복사 생성자·복사 대입 연산자"
#include <cstring>
#include <iostream>

class Buffer {
public:
    explicit Buffer(std::size_t n) : size_(n), data_(new int[n]) {
        for (std::size_t i = 0; i < n; ++i) data_[i] = static_cast<int>(i);
    }

    // 깊은 복사 생성자 -- 새 버퍼를 힙에 따로 잡고 내용만 복사한다
    Buffer(const Buffer& other) : size_(other.size_), data_(new int[other.size_]) {
        std::memcpy(data_, other.data_, size_ * sizeof(int));
    }

    // 깊은 복사 대입 연산자 -- 자기 대입 방어가 반드시 필요하다
    Buffer& operator=(const Buffer& other) {
        if (this == &other) return *this;        // b = b; 방어
        int* new_data = new int[other.size_];      // 실패해도 기존 data_는 안전하다
        std::memcpy(new_data, other.data_, other.size_ * sizeof(int));
        delete[] data_;
        data_ = new_data;
        size_ = other.size_;
        return *this;
    }

    ~Buffer() { delete[] data_; }

    std::size_t size_;
    int* data_;
};

int main() {
    Buffer a(5);
    Buffer b = a;   // 이제 깊은 복사 생성자가 호출된다
    std::cout << "a.data_ = " << a.data_ << "\n";
    std::cout << "b.data_ = " << b.data_ << "  (a.data_와 다르다)\n";

    b.data_[0] = 999;
    std::cout << "b 수정 후 a.data_[0] = " << a.data_[0] << "  (영향 없음)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address deep_copy.cpp -o deep_copy_asan
$ ./deep_copy_asan
a.data_ = 0x503000000040
b.data_ = 0x503000000070  (a.data_와 다르다)
b 수정 후 a.data_[0] = 0  (영향 없음)
```

주소가 다르다는 것 자체가 증거다 — `a`와 `b`는 이제 각자의 힙 블록을 갖는다. ASan 빌드가 아무 리포트 없이 종료 코드 0으로 끝난다는 것도 확인해 둘 가치가 있다. `b`의 소멸자와 `a`의 소멸자가 각각 다른 주소를 `delete[]`하니 이중 해제가 아예 성립하지 않는다.

복사 대입 연산자의 `if (this == &other)`는 장식이 아니다. 이 줄을 빼고 "먼저 지우고, 그다음 새로 잡고, 그다음 복사"하는 순서로 짜면 자기 대입(`b = b;`) 앞에서 조용히 깨진다.

```cpp title="broken_selfassign.cpp — 자기 대입 방어가 없는 버전"
Buffer& operator=(const Buffer& other) {
    delete[] data_;                                                    // other.data_도 같은 객체다!
    data_ = new int[other.size_];
    std::memcpy(data_, other.data_, other.size_ * sizeof(int));        // 이미 새로 할당된, 초기화 안 된 자기 자신을 읽는다
    size_ = other.size_;
    return *this;
}
```

`b = b;`에서 `other`는 `b` 자신에 대한 별명이다. `delete[] data_;`가 `b.data_`를 해제하는 순간 `other.data_`도 이미 해제된 것이고, 그다음 `new int[...]`가 **같은 멤버 변수 `data_`**에 새 주소를 채운다 — `other`도 `b`이므로 `other.data_`가 그 새 주소로 같이 바뀐다. 그 뒤의 `memcpy`는 방금 만든, 아직 아무 값도 안 채워진 새 버퍼를 자기 자신에게서 읽는 꼴이 된다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address broken_selfassign.cpp -o broken_selfassign_asan
$ ./broken_selfassign_asan
b.data_[0] = -1094795586
```

::: warn ASan조차 이 버그를 못 잡는다 — 그래서 더 위험하다
크래시도, ASan 리포트도 없다. 실행은 "성공"하고 종료 코드는 0이다. 다만 `b.data_[0]`이 원래 있던 값(0)이 아니라 `-1094795586`(malloc이 갓 내준 초기화 안 된 메모리의 전형적인 쓰레기 패턴)으로 조용히 바뀌었을 뿐이다. **자기 대입 버그는 대개 크래시가 아니라 데이터 손상으로 나타난다** — 크래시라면 바로 걸리기라도 하지, 이건 리뷰도 테스트도 통과하고 나서 한참 뒤에야 "이 객체 값이 왜 이상하지"로 발견된다. `if (this == &other) return *this;` 한 줄이 이 클래스 전체의 이 실패 모드를 원천 차단한다.
:::

## 복사 대입에서 강한 예외 보장 맛보기

방금 쓴 `operator=`는 순서를 신경 써서 짰다 — `new`가 실패(예외)해도 `delete[] data_`는 아직 실행 전이라 `data_`는 여전히 유효하다. 이 순서 감각을 관용구로 뽑아낸 것이 **copy-and-swap**이다. 복사본을 하나 만들고(그 복사가 실패하면 `*this`는 원래 상태 그대로), 성공한 복사본과 `*this`의 내용을 `swap`으로 맞바꾸기만 하면, 대입 연산자 전체가 "성공하거나, 아무 일도 없었던 것처럼 실패하거나" 둘 중 하나가 된다.

::: tip copy-and-swap은 자기 대입 방어까지 공짜로 딸려온다
`operator=(Buffer other)`처럼 인자를 **값으로** 받으면 그 순간 이미 깊은 복사가 한 번 끝난 상태다. 그 복사본과 `*this`를 `swap`하고 함수가 끝나면, 임시로 들고 있던(원래 `*this`가 갖고 있던) 자원이 `other`의 소멸자를 통해 자동으로 정리된다 — `delete`를 직접 쓸 필요도, `if (this == &other)`를 따로 검사할 필요도 없다. `other`가 `*this`의 복사본이므로 자기 대입이어도 문제가 안 생긴다. 지금 쓴 수동 버전과 이 관용구가 왜 같은 안전성을 향해 있는지는 [2.8 Rule of 0/3/5](#/rule-of-five)에서 정리한다.
:::

## 복사 비용 실측

[1.6 함수: 오버로딩과 인자 전달](#/functions)에서 8KB 구조체를 값으로 넘기면 호출마다 통째로 복사된다는 것을 함수 인자 자리에서 쟀다. 지금은 같은 비용을 대입·복사 연산 자체에서, 그리고 컨테이너 안에서 잰다.

```cpp title="copy_cost.cpp — 38MB 버퍼를 20번 복사"
constexpr std::size_t N = 10'000'000;   // int 4바이트 x 1000만 = 약 38MB
constexpr int REPEAT = 20;
Buffer original(N);

auto t0 = std::chrono::steady_clock::now();
for (int i = 0; i < REPEAT; ++i) {
    Buffer copy = original;   // 매번 38MB를 새로 할당하고 memcpy
}
auto t1 = std::chrono::steady_clock::now();
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 copy_cost.cpp -o copy_cost
$ ./copy_cost
버퍼 크기: 38 MB
복사 20회 총 시간: 466.232 ms
복사 1회 평균: 23.3116 ms
```

(g++ 13.3 / `-O2` / Linux x86-64 실측. 절대 시간은 기기·메모리 대역폭마다 다르다 — 반복 실행에서 20~35ms 사이로 흔들렸지만, "38MB 복사 한 번에 수십 밀리초"라는 자릿수는 안정적이다.) 이 정도 크기의 복사를 실시간 제어 루프(주기 1ms) 안에서 실수로 한 번이라도 만들면 그 주기 하나를 통째로 태운다.

더 흔한 함정은 컨테이너 안에서 일어난다. `std::vector`에 원소를 100번 `push_back`하면 복사가 몇 번 일어날까 — 직관은 "100번"이지만, 재할당이 일어날 때마다 **기존 원소도 새 버퍼로 다시 복사**된다는 것을 카운터로 확인한다.

```cpp title="vector_copies.cpp — 복사 생성자를 셀 수 있게 카운터를 심는다"
class Buffer {
public:
    static inline int copy_count = 0;
    Buffer(const Buffer& other) : size_(other.size_), data_(new int[other.size_]) {
        std::memcpy(data_, other.data_, size_ * sizeof(int));
        ++copy_count;
    }
    // (생성자·소멸자·operator= 생략 — deep_copy.cpp와 동일)
};

int main() {
    std::vector<Buffer> v;
    for (int i = 0; i < 100; ++i) v.push_back(Buffer(4));
    std::cout << "누적 복사 횟수 = " << Buffer::copy_count << "\n";
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 vector_copies.cpp -o vector_copies
$ ./vector_copies
size=1 시점 재할당 -> capacity=1, 누적 copy_count=1
size=2 시점 재할당 -> capacity=2, 누적 copy_count=3
size=3 시점 재할당 -> capacity=4, 누적 copy_count=6
size=5 시점 재할당 -> capacity=8, 누적 copy_count=12
size=9 시점 재할당 -> capacity=16, 누적 copy_count=24
size=17 시점 재할당 -> capacity=32, 누적 copy_count=48
size=33 시점 재할당 -> capacity=64, 누적 copy_count=96
size=65 시점 재할당 -> capacity=128, 누적 copy_count=192
최종 push_back 100회, 누적 복사 횟수 = 227
```

`push_back` 100번에 복사는 **227번** 일어났다. 매 재할당마다 그때까지 쌓인 원소 전부를 새 버퍼로 옮겨야 하고, `Buffer`에는 이동 생성자가 없어(직접 쓴 소멸자·복사 생성자·복사 대입 연산자가 있으면 컴파일러는 이동 생성자를 자동으로 만들어 주지 않는다 — 이 규칙 자체는 [2.8](#/rule-of-five)의 주제다) `vector`가 재할당 시 쓸 수 있는 유일한 수단이 복사뿐이었다. capacity가 1→2→4→8...로 두 배씩 뛰는 [5.1 vector: 내부 구조와 성장 전략](#/vector)의 패턴과, 그 성장 한 번마다 지불하는 복사 비용이 정확히 겹쳐 보인다.

::: perf 왜 227인가
`push_back`이 불릴 때마다 새 원소 하나를 위한 복사가 1번, 그리고 그 호출이 재할당을 유발했다면 기존 원소 전체를 위한 복사가 추가로 일어난다. capacity가 $c$에서 $2c$로 자랄 때 옮겨야 할 기존 원소는 $c$개다. $c = 1, 2, 4, 8, 16, 32, 64$의 합이 127, 여기에 매 push마다 최소 1번씩 드는 신규 삽입 복사 100번을 더하면 227이 된다. **이동 생성자가 있었다면 기존 원소 복사분(127번)이 전부 사라지고 100번만 남았을 것이다** — 이동 시맨틱이 왜 필요한지의 가장 직접적인 실측 근거이고, [2.7 이동 시맨틱과 rvalue 레퍼런스](#/move-semantics)가 정확히 이 127번을 없애는 이야기다.
:::

## =delete로 복사 금지하기

모든 클래스가 복사돼야 하는 건 아니다. 파일 핸들, 뮤텍스, 네트워크 소켓처럼 **자원을 유일하게 소유해야 하는** 타입은 복사 자체가 개념적으로 말이 안 된다 — 뮤텍스 두 개가 "같은 락"이라는 게 무슨 뜻인지 정의할 방법이 없다. 이럴 때는 깊은 복사를 구현하는 대신 복사 자체를 금지한다.

```cpp title="no_copy.cpp — 복사를 아예 막는다"
class FileHandle {
public:
    explicit FileHandle(const char* path);
    ~FileHandle();

    FileHandle(const FileHandle&) = delete;             // 복사 생성자 금지
    FileHandle& operator=(const FileHandle&) = delete;  // 복사 대입 금지
private:
    int fd_;
};
```

`= delete`를 붙인 함수는 오버로드 해석 후보에는 들어가지만 실제로 골라지면 컴파일 에러를 낸다 — `FileHandle b = a;`라고 쓰는 순간 "이 함수는 삭제됐다"는 명확한 에러가 뜬다. 애매하게 복사되다 자원을 두 곳에서 관리하는 버그보다, 컴파일 시점에 확실히 막는 쪽이 훨씬 안전하다. `std::unique_ptr`가 정확히 이 패턴으로 구현돼 있다는 것, 그리고 복사는 막되 **이동**은 허용해서 소유권만 넘기는 절충안은 [2.8 Rule of 0/3/5](#/rule-of-five)와 [2.9 unique_ptr: 독점 소유권](#/unique-ptr)에서 이어서 다룬다.

## 로보틱스 도메인: 로봇 상태를 값으로 넘기는 비용

헥사포드 6다리 × 3자유도 관절의 위치·속도·토크를 담는 상태 구조체를 만들고, 이걸 값으로 받는 함수와 참조로 받는 함수를 각각 반복 호출해 본다.

```cpp title="robot_state_cost.cpp — 464바이트 구조체를 값 vs 참조로 반복 호출"
struct RobotState {
    std::array<double, 18> position{};
    std::array<double, 18> velocity{};
    std::array<double, 18> effort{};
    std::string frame_id = "base_link";
};

void process_by_value(RobotState s) { sink += s.position[0]; }     // 호출마다 464바이트 복사
void process_by_ref(const RobotState& s) { sink += s.position[0]; } // 복사 없음
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 robot_state_cost.cpp -o robot_state_cost
$ ./robot_state_cost
sizeof(RobotState) = 464 bytes
값 전달 2000000회: 15.0787 ms (0.00753935 us/회)
참조 전달 2000000회: 5.55729 ms (0.00277864 us/회)
```

값 전달이 참조 전달보다 약 **2.7배** 느리다(g++ 13.3 / `-O2` 실측, 반복 실행에서 2.6~2.9배 사이). 464바이트 자체는 작아 보이지만, 이 구조체가 [10.2 토픽: publisher와 subscription](#/pub-sub)의 콜백 체인을 몇 단 거치거나 [6.8 실시간 제약과 제어 루프](#/realtime)의 1kHz 주기 안에서 여러 서브시스템(IK 솔버, 안정성 체크, 로깅)에 값으로 계속 넘겨진다면, 이 절에서 잰 복사 한 번의 비용이 호출 경로의 단수만큼 누적된다. `frame_id`가 `"base_link"`처럼 SSO 버퍼 안에 들어가는 짧은 문자열이라 힙 할당조차 없었는데도 이 정도 차이가 났다는 게 핵심이다 — 문자열이 길어져 힙 할당이 끼어드는 순간 배율은 이보다 커진다. rclcpp 콜백 시그니처가 습관적으로 `const T&`인 이유가 [2.3](#/references)에서 이미 나왔던 그 이유 그대로, 여기서 다시 확인된다.

::: interview 얕은 복사와 깊은 복사의 차이
메모리 관련 질문 중 댕글링 포인터 다음으로 자주 나온다. 답변 뼈대: ① **얕은 복사**는 컴파일러가 기본으로 만들어 주는 멤버별 복사다 — 포인터 멤버가 있으면 가리키는 대상이 아니라 주소 값만 복사된다. ② **깊은 복사**는 포인터가 가리키는 자원을 새로 할당해서 내용을 옮기는 것 — 원본과 복사본이 각자의 자원을 갖는다. ③ 얕은 복사가 문제가 되는 정확한 조건은 "그 클래스가 원시 포인터로 자원을 소유하는가"다 — 값 타입 멤버만 있거나(이 절의 `RobotPose` 실측), 멤버가 스스로 올바른 복사를 구현한 타입(`std::string`, `std::vector`)이면 얕은 복사(멤버별 복사)가 그 자체로 이미 깊은 복사다. ④ 실전 처방은 두 갈래다 — 자원을 소유하는 클래스는 깊은 복사를 손으로 구현하거나(이 절의 `Buffer`), 아예 복사를 `= delete`하고 스마트 포인터로 소유권을 표현한다(다음은 Rule of Three로 이어진다 — "복사 생성자·복사 대입·소멸자 중 하나가 필요하면 셋 다 필요하다"는 경험칙까지 붙이면 상급 답변이다).
:::

## 요약

- 컴파일러가 만드는 암묵적 복사 생성자·복사 대입 연산자는 **멤버별 복사**다 — 원시 타입 멤버는 값을 그대로, 스스로 복사를 구현한 멤버(`std::string` 등)는 그 타입의 복사가 불린다.
- 소유하는 원시 포인터 멤버가 있으면 멤버별 복사는 **얕은 복사**가 된다 — 주소만 복사돼 두 객체가 같은 힙 블록을 가리킨다. 실측: `b`가 먼저 소멸하며 `delete[]`한 메모리를 `a`가 읽어(`heap-use-after-free`) 프로그램 종료 시 같은 주소를 또 `delete[]`(`double free`)한다.
- 값 타입 멤버만 있는 클래스(POD성 구조체)는 얕은 복사와 깊은 복사가 같다 — 실측: `RobotPose` 복사 후 두 객체가 완전히 독립적이었고 `frame_id`의 주소도 서로 달랐다.
- 소유 포인터가 있는 클래스는 복사 생성자·복사 대입 연산자를 직접 써서 **새 자원을 할당하고 내용만 복사**해야 한다. 복사 대입에는 반드시 자기 대입(`this == &other`) 방어가 필요하다 — 방어가 없으면 크래시조차 없이 데이터가 조용히 손상된다(실측: `-1094795586`).
- 복사는 공짜가 아니다 — 38MB 버퍼 복사 1회 약 20~35ms(실측), `vector`에 100번 `push_back`하면 재할당 때마다 기존 원소가 다시 복사돼 총 227회의 복사가 일어난다(실측). 이동 생성자가 있었다면 100회로 줄었을 127번이다.
- 복사 자체가 말이 안 되는 자원 소유 타입은 `= delete`로 복사를 금지한다. 로봇 상태 구조체(464바이트)를 값으로 반복 전달하면 참조 전달보다 약 2.7배 느리다(실측) — rclcpp 콜백이 `const&`를 쓰는 이유가 이 비용이다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습(코드 작성형)이다.

1. `shallow_copy.cpp`에서 `Buffer`에 복사 생성자를 선언한 줄이 하나도 없는데 `Buffer b = a;`가 컴파일된 이유를 한 문장으로 설명하라. 이 클래스에 `std::string name;` 멤버를 추가해도 `name` 자체는 여전히 안전하게 복사되는 이유는 무엇인가?

2. `broken_selfassign.cpp`의 `operator=`는 ASan으로도 잡히지 않았다. 왜 이 버그는 스캐너로 못 잡는 종류인가? `if (this == &other) return *this;` 한 줄이 정확히 어느 시점의 어떤 재할당을 막는지 설명하라.

3. `vector_copies.cpp`에서 `push_back`을 100번이 아니라 200번으로 늘리면 재할당은 몇 번 더 일어나고(capacity가 어떤 값들을 거치는지), 누적 `copy_count`는 대략 몇이 될지 예측하라. 정확한 숫자보다 "왜 그 값 근처인지"의 논리를 먼저 써라.

4. (실습) `shallow_copy.cpp`를 직접 쳐서 이중 해제를 재현하라. 먼저 새니타이저 없이 빌드해 `free(): double free detected` 메시지를 확인하고, 그다음 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address`로 다시 빌드해 `heap-use-after-free` 리포트를 받아라. 그 위에 `deep_copy.cpp`의 복사 생성자·복사 대입 연산자를 그대로 옮겨 붙여 클래스를 고치고, 같은 ASan 빌드가 리포트 없이 종료 코드 0으로 끝나는 것까지 확인하라. 성공 기준: 고치기 전 리포트와 고친 후의 무보고 종료를 같은 화면에서 비교했다.
5. (실습) `Buffer`에 `static inline int copy_count = 0;`을 추가하고 복사 생성자에서 증가시켜라. `std::vector<Buffer> v; v.reserve(100);`로 미리 공간을 확보한 뒤 100번 `push_back`했을 때의 `copy_count`와, `reserve` 없이 100번 `push_back`했을 때의 `copy_count`를 각각 재고 비교하라. 성공 기준: `reserve`를 미리 했을 때 `copy_count`가 정확히 100(또는 그에 아주 가까운 값)으로 줄어드는 것을 직접 실측했다.
:::

::: answer 해설
1. 클래스가 복사 생성자를 직접 선언하지 않으면 컴파일러가 규칙(멤버별 복사)에 따라 암묵적 복사 생성자를 만들어 채워 넣는다 — "복사 생성자가 없다"가 아니라 "직접 쓰지 않았을 뿐 컴파일러가 만들어 뒀다"가 정확한 표현이다. `std::string name;`을 추가해도 `name`은 안전하다 — 멤버별 복사는 각 멤버를 "그 멤버 타입의 복사 방법"으로 복사하는데, `std::string`은 자기 자신이 깊은 복사를 구현한 타입이라 `Buffer`가 아무것도 안 해도 `name`만은 올바르게 복사된다. 위험한 건 오직 `int* data_`처럼 원시 포인터로 자원을 소유하는 멤버뿐이다.
2. ASan은 "메모리 접근이 유효한 할당 범위 안에 있는가"를 감시하는 도구다. 자기 대입 버그는 `delete`와 `new`를 순서대로 실행해 **항상 유효한 메모리에** 접근한다 — 다만 그 메모리가 방금 자기 자신에게 재할당된, 아직 값이 안 채워진 자리라서 논리적으로 잘못된 값을 읽을 뿐이다. 유효성 위반이 아니라 로직 오류라서 새니타이저의 감시 범위 밖이다. `if (this == &other) return *this;`는 `b = b;`처럼 `other`가 `*this`와 같은 객체를 가리키는 경우, `delete[] data_`가 실행되기 **전에** 함수를 끝내 버려서 "자기 자신을 지우고 자기 자신에게서 읽는" 재할당 자체가 시작되지 않게 막는다.
3. capacity는 1, 2, 4, 8, 16, 32, 64, 128, 256으로 자란다(128 이후 한 번 더 재할당이 필요, 200이 128과 256 사이라서). 기존 원소 복사분은 $1+2+4+\dots+128 = 255$, 여기에 매 push마다의 신규 삽입 복사 200번을 더하면 대략 455 근처다. 논리는 본문의 "$c=1,2,4,\dots$의 합에 push 횟수를 더한다"는 식과 완전히 같고, 재할당 문턱을 넘는 시점(=2의 거듭제곱을 지나는 순간)마다 그때까지의 원소 전부가 다시 복사된다는 것이 핵심이다.
4. 첫 빌드(새니타이저 없음)는 `free(): double free detected in tcache 2`로 곧바로 죽는다. ASan 빌드는 `heap-use-after-free`를 리포트하며 `freed by`와 `previously allocated by` 두 스택 트레이스로 각각 8번째 줄(소멸자)과 5번째 줄(생성자)을 짚는다. `deep_copy.cpp`의 두 함수를 그대로 옮기면 같은 ASan 빌드가 아무 리포트 없이 조용히 끝난다 — `a`와 `b`가 각자의 힙 블록을 갖게 됐기 때문이다.
5. `reserve(100)`으로 미리 공간을 확보하면 100번의 `push_back` 동안 재할당이 아예 일어나지 않는다 — capacity가 이미 100 이상이므로 매 삽입은 신규 원소 복사 1번뿐이고, 기존 원소를 옮기는 복사는 발생하지 않는다. `reserve` 없이는 본문 실측처럼 227번(또는 그 근처) — 반면 `reserve` 후에는 정확히 100번에 수렴한다. 이 차이가 [5.1 vector](#/vector)에서 `reserve`를 미리 부르라고 강조하는 이유의 실측 근거다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `shallow_copy.cpp`는 새니타이저 없이/있이 두 번 다 돌려서 "죽는 방식이 다르다"는 것을 눈으로 보고, `broken_selfassign.cpp`는 크래시가 안 나는데도 값이 틀렸다는 것을 직접 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [2.7 이동 시맨틱과 rvalue 레퍼런스](#/move-semantics) — 이 절에서 만든 `Buffer`를 다시 꺼내 온다. 깊은 복사로 고치긴 했지만, `Buffer make_buffer() { return Buffer(1000); }`처럼 함수가 반환하는 임시 버퍼를 받을 때조차 매번 새로 힙을 할당하고 내용을 복사한 뒤 원본을 버리는 건 낭비다 — 어차피 버려질 원본이라면 내용을 복사할 게 아니라 그 자원 자체를 통째로 넘겨받으면 된다. `std::move`가 정확히 이 상황을 위한 도구이고, 다음 절의 `ownership-move` 위젯이 복사(원본 유지, 두 자원 존재)와 이동(원본이 빈 상태가 됨, 자원 하나만 존재) 사이의 차이를 이 절이 세운 문제 그대로 애니메이션으로 보여준다.
