# 5.2 map, set, unordered_map

::: lead
[5.1 vector](#/vector)는 인덱스로 접근하는 자료구조였다. 그런데 조인트 이름으로 각도를 찾거나, 토픽 이름으로 publisher를 찾는 문제는 인덱스가 아니라 **키**로 접근해야 한다. C++ 표준 라이브러리는 이 문제에 두 가지 답을 준다 — `std::map`과 `std::unordered_map`이다. 이름은 비슷하지만 내부 구조가 완전히 다르고, 그 차이가 정렬 여부와 실제 실행 속도 양쪽에 그대로 드러난다. 이 절은 그 차이를 소스 코드와 실측으로 끝까지 파헤친다.
:::

## 1. 겉보기엔 같은 인터페이스, 순회하면 바로 갈린다

`map`과 `unordered_map` 둘 다 `키[] = 값` 문법을 지원하고, 둘 다 `find`를 지원한다. 인터페이스만 보면 둘 중 뭘 써도 상관없어 보인다. 그런데 순회 순서를 찍어 보면 이야기가 달라진다.

```cpp title="order_demo.cpp — 같은 다섯 개의 조인트 이름을 두 컨테이너에 넣고 순회한다"
#include <iostream>
#include <map>
#include <unordered_map>
#include <string>

int main() {
    std::map<std::string, int> ordered;
    std::unordered_map<std::string, int> unordered;

    for (const std::string name : {"wheel_joint", "arm_joint", "base_joint",
                                    "leg_joint", "camera_joint"}) {
        ordered[name] = 0;
        unordered[name] = 0;
    }

    std::cout << "-- std::map (정렬됨) --\n";
    for (const auto& [k, v] : ordered) std::cout << "  " << k << "\n";

    std::cout << "-- std::unordered_map (정렬 안 됨) --\n";
    for (const auto& [k, v] : unordered) std::cout << "  " << k << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra order_demo.cpp -o order_demo
$ ./order_demo
-- std::map (정렬됨) --
  arm_joint
  base_joint
  camera_joint
  leg_joint
  wheel_joint
-- std::unordered_map (정렬 안 됨) --
  camera_joint
  leg_joint
  base_joint
  arm_joint
  wheel_joint
```

(g++ 13.3 실측.) `map`은 삽입 순서와 무관하게 항상 키 기준 오름차순으로 순회된다 — `arm_joint`가 알파벳으로 가장 앞이라 첫 줄에 나온다. `unordered_map`은 삽입 순서도, 알파벳 순서도 아닌 **제3의 순서**로 나온다. 이 순서는 각 키의 해시값을 내부 버킷 개수로 나눈 나머지로 정해지는데, 표준은 이 순서에 대해 아무 보장도 하지 않는다 — 같은 프로그램을 다른 libstdc++ 버전에서 돌리면 순서가 달라질 수 있다. `set`과 `unordered_set`도 정확히 같은 관계다. 값 하나만 저장할 뿐, 정렬 여부는 그대로 물려받는다.

::: note set은 map에서 값을 뺀 것과 같다
`std::set<Key>`는 `std::map<Key, /* 값 없음 */>`과 사실상 같은 내부 트리를 쓴다. libstdc++ 소스(`bits/stl_set.h`)를 보면 `set`도 `map`과 똑같이 `_Rb_tree`를 멤버로 갖는다 — 차이는 트리 노드에 값(`mapped_type`)을 붙이느냐뿐이다. 이 절의 모든 내용(정렬, 실측 비용, 해시 특수화)은 `set`/`unordered_set`에도 그대로 적용된다.
:::

## 2. 이 순서 차이가 어디서 오는가: 레드-블랙 트리 vs 해시 테이블

정렬 여부는 우연이 아니라 두 컨테이너의 근본적으로 다른 내부 구조에서 나온다. libstdc++ 헤더를 직접 열어 보면 그 구조가 그대로 드러난다.

```console
$ grep -n "class map" /usr/include/c++/13/bits/stl_map.h
102:    class map
$ grep -n "_Rb_tree" /usr/include/c++/13/bits/stl_map.h | head -1
154:      typedef _Rb_tree<key_type, value_type, _Select1st<value_type>,
$ grep -n "class unordered_map" /usr/include/c++/13/bits/unordered_map.h
109:    class unordered_map
$ grep -n "_Hashtable" /usr/include/c++/13/bits/unordered_map.h | head -1
53:    using __umap_hashtable = _Hashtable<_Key, std::pair<const _Key, _Tp>,
```

(Ubuntu 24.04 / g++ 13.3에 딸린 libstdc++ 헤더 실측 grep.) `map`의 실제 멤버는 `_Rb_tree`(**레드-블랙 트리**, `bits/stl_tree.h` 83번 줄 주석에 "Red-black tree class"라고 명시돼 있다)고, `unordered_map`의 실제 멤버는 `_Hashtable`(**해시 테이블**)이다. 표준은 구현을 이 둘로 못 박지 않지만, libstdc++·libc++ 모두 이 두 구조로 구현한다 — 표준이 요구하는 복잡도 보장(삽입·탐색이 각각 로그, 평균 상수 시간) 자체가 사실상 이 두 구조 말고는 만족시키기 어렵기 때문이다.

레드-블랙 트리는 이진 탐색 트리에 "빨강/검정 색칠 규칙"으로 균형을 강제로 유지하는 구조다. 삽입·삭제 때마다 이 규칙이 깨지면 회전(rotation)으로 다시 맞춘다 — 그 대가로 트리 높이가 항상 $2\log_2(n+1)$을 넘지 않는다는 게 이 자료구조의 수학적 보장이다. 원소 100만 개를 넣어도 뿌리에서 잎까지 최대 약 40단계면 도달한다. 다섯 개짜리 예시를 트리로 그리면 이렇다.

```text nolines
              base_joint
             /          \
        arm_joint      wheel_joint
             \               \
        camera_joint      leg_joint
```

(정렬 순서 오름차순 왼쪽-오른쪽 배치. 실제 libstdc++의 색칠·회전 결과와 세부 모양은 다를 수 있지만, "왼쪽 서브트리의 모든 키 < 노드 키 < 오른쪽 서브트리의 모든 키"라는 이진 탐색 트리 불변식과 균형 유지 원리는 항상 같다.) `find`는 뿌리에서 시작해 찾는 키와 비교하며 왼쪽 또는 오른쪽으로 내려간다 — 매 단계 트리가 절반 가까이 줄어드니 $O(\log n)$이다. 순회가 정렬된 순서로 나오는 이유도 이 구조에 있다 — 왼쪽 서브트리부터, 노드 자신, 오른쪽 서브트리 순으로 방문하는 중위 순회(in-order traversal)가 곧 오름차순이다.

해시 테이블은 완전히 다른 원리다. 키를 `std::hash`로 정수 하나(해시값)로 뭉갠 뒤, 그 값을 버킷(bucket) 개수로 나눈 나머지로 "몇 번 버킷에 넣을지"를 정한다.

```text nolines
버킷 배열 (bucket_count개의 슬롯)
[0]  -> (비어있음)
[1]  -> [leg_joint]
[2]  -> (비어있음)
 ...
[9]  -> [wheel_joint] -> [arm_joint]   (같은 버킷에 두 키가 몰렸다 -- 해시 충돌)
[10] -> [base_joint]
 ...
[12] -> [camera_joint]
```

키가 어느 버킷에 들어가는지는 해시값이 정하지, 알파벳 순서나 삽입 순서와는 무관하다 — 그래서 순회 순서가 뒤죽박죽으로 보인다. 해시값이 균등하게 흩어지고 버킷 하나에 원소가 하나 정도만 몰린다면, `find`는 버킷 번호를 계산해 그 버킷 하나만 보면 끝난다 — 평균 $O(1)$이다.

## 3. 실측: 삽입·탐색 시간 — 10만 개와 100만 개

이론상의 $O(\log n)$과 평균 $O(1)$이 실제로 얼마나 차이 나는지, 무작위 순서로 섞은 정수 키를 넣고 찾는 벤치마크로 직접 잰다.

```cpp title="bench.cpp — map/unordered_map의 삽입·탐색을 10만/100만 건으로 실측"
#include <chrono>
#include <iostream>
#include <map>
#include <unordered_map>
#include <vector>
#include <random>
#include <algorithm>

using Clock = std::chrono::steady_clock;

template <typename Container>
double bench_insert(const std::vector<int>& keys) {
    Container c;
    auto t0 = Clock::now();
    for (int k : keys) c[k] = k;
    auto t1 = Clock::now();
    return std::chrono::duration<double, std::milli>(t1 - t0).count();
}

template <typename Container>
double bench_lookup(const Container& c, const std::vector<int>& queries, long long& sink) {
    auto t0 = Clock::now();
    for (int k : queries) {
        auto it = c.find(k);
        if (it != c.end()) sink += it->second;
    }
    auto t1 = Clock::now();
    return std::chrono::duration<double, std::milli>(t1 - t0).count();
}

void run(std::size_t n) {
    std::vector<int> keys(n);
    for (std::size_t i = 0; i < n; ++i) keys[i] = static_cast<int>(i);
    std::mt19937 rng(12345);
    std::shuffle(keys.begin(), keys.end(), rng);   // 삽입 순서를 무작위로 섞는다
    std::vector<int> queries = keys;
    std::shuffle(queries.begin(), queries.end(), rng);

    double map_insert_ms  = bench_insert<std::map<int, int>>(keys);
    double umap_insert_ms = bench_insert<std::unordered_map<int, int>>(keys);

    std::map<int, int> m;            for (int k : keys) m[k] = k;
    std::unordered_map<int, int> um; for (int k : keys) um[k] = k;

    long long sink1 = 0, sink2 = 0;
    double map_lookup_ms  = bench_lookup(m, queries, sink1);
    double umap_lookup_ms = bench_lookup(um, queries, sink2);
    // ... 결과 출력
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 bench.cpp -o bench
$ ./bench
N=100000
  map        insert: 24.4799 ms  (1건 평균 244.799 ns)
  unordered_map insert: 8.61145 ms  (1건 평균 86.1145 ns)
  map        lookup: 23.9734 ms  (1건 평균 239.734 ns)
  unordered_map lookup: 1.83834 ms  (1건 평균 18.3834 ns)
N=1000000
  map        insert: 781.576 ms  (1건 평균 781.576 ns)
  unordered_map insert: 280.77 ms  (1건 평균 280.77 ns)
  map        lookup: 994.994 ms  (1건 평균 994.994 ns)
  unordered_map lookup: 39.2015 ms  (1건 평균 39.2015 ns)
```

(g++ 13.3 / `-O2` / Intel Xeon 2.80GHz, Linux x86-64 실측. 세 번 반복 실행에서 N=100,000은 삽입 24.5~28.3ms/8.6~9.3ms, 탐색 24.0~33.0ms/1.8~2.2ms 사이로, N=1,000,000은 삽입 782~1052ms/281~370ms, 탐색 995~1144ms/37.0~39.2ms 사이로 흔들렸다 — 위 수치는 그중 한 번의 실행값이다.) 삽입에서는 `unordered_map`이 약 2.8배(100만 건 기준 781.6ms 대 280.8ms) 빠르다. 하지만 **탐색에서 차이가 훨씬 크게 벌어진다** — 100만 건 기준 `map` 탐색 994.994ms, `unordered_map` 탐색 39.2015ms으로, $994{,}994\text{ns} \div 39{,}201.5\text{ns} \approx 25.4$배다. 트리는 탐색 한 번에 $\log_2(1{,}000{,}000) \approx 20$번 안팎의 노드를 타고 내려가며 각 단계 포인터를 따라가야 하는 반면(포인터를 따라갈 때마다 캐시 미스가 날 확률이 높다 — [8.2 캐시와 메모리 레이아웃](#/cache)에서 이 비용을 정식으로 다룬다), 해시 테이블은 해시값 계산 한 번과 버킷 하나 접근으로 끝나기 때문이다.

::: perf N이 늘면 격차가 더 벌어지는가
$O(\log n)$과 $O(1)$의 정의상, N이 10배(10만 → 100만) 늘 때 `map`의 1건당 시간은 이론적으로 $\log_2(1{,}000{,}000)/\log_2(100{,}000) \approx 20/17 \approx 1.18$배만 늘어야 한다. 실측으로는 탐색 1건당 239.7ns → 995.0ns로 약 4.15배 늘었다 — 순수 트리 높이 증가분보다 훨씬 크다. 이 차이 대부분은 데이터가 커지면서 트리 노드들이 캐시에 덜 들어맞게 되는 캐시 효과다 — `map`의 노드는 힙 곳곳에 흩어져 있어([2.12 객체 메모리 레이아웃](#/object-layout) 참고) N이 커질수록 상위 캐시 레벨에 안 들어가는 노드 비율이 늘어난다. `unordered_map`은 18.4ns → 39.2ns로 약 2.1배 늘었는데, 이 역시 평균 $O(1)$ 안에서 버킷 재해시·체인 길이 변화로 인한 부가 비용이다.
:::

## 4. 해시 충돌과 버킷: bucket_count(), load_factor()

앞서 그린 해시 테이블 다이어그램의 "같은 버킷에 두 키가 몰렸다"는 상황이 실제로 얼마나 자주 일어나는지, `bucket_count()`와 `load_factor()`로 직접 들여다본다.

```cpp title="bucket_demo.cpp — 버킷 개수와 부하율을 실측한다"
#include <iostream>
#include <unordered_map>
#include <string>

int main() {
    std::unordered_map<std::string, int> joint_index;
    joint_index["coxa_1"] = 0;
    joint_index["femur_1"] = 1;
    joint_index["tibia_1"] = 2;

    std::cout << "bucket_count = " << joint_index.bucket_count() << "\n";
    std::cout << "load_factor = " << joint_index.load_factor() << "\n";

    for (int i = 0; i < 100; ++i) joint_index["leg_" + std::to_string(i)] = i;
    std::cout << "-- 100개 추가 삽입 후 --\n";
    std::cout << "bucket_count = " << joint_index.bucket_count() << "\n";
    std::cout << "load_factor = " << joint_index.load_factor() << "\n";

    std::size_t idx = joint_index.bucket("coxa_1");
    std::cout << "\"coxa_1\"의 버킷 번호 = " << idx
              << ", 그 버킷의 원소 수 = " << joint_index.bucket_size(idx) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra bucket_demo.cpp -o bucket_demo
$ ./bucket_demo
bucket_count = 13
load_factor = 0.230769
-- 100개 추가 삽입 후 --
bucket_count = 127
load_factor = 0.811024
"coxa_1"의 버킷 번호 = 61, 그 버킷의 원소 수 = 2
```

(g++ 13.3 실측.) `load_factor()`는 `size() / bucket_count()`다 — 원소 3개에 버킷 13개로 시작해 0.23이었다가, 103개를 담자 127개 버킷에 0.81까지 올라갔다. libstdc++는 기본 `max_load_factor()`(1.0)를 넘으려는 순간 버킷 개수를 자동으로 늘리고(**재해시**, rehash) 모든 원소를 새 버킷에 다시 분배한다 — 13에서 127로 뛴 게 그 결과다. 마지막 줄이 **해시 충돌**을 실측으로 보여준다 — `"coxa_1"`이 들어간 61번 버킷에 원소가 2개 있다는 건, 다른 키 하나가 `"coxa_1"`과 같은 해시값(나머지 기준)을 얻어 같은 버킷에 체인으로 걸렸다는 뜻이다. 해시 충돌은 버그가 아니라 해시 테이블 설계상 항상 일어날 수 있는 정상 상황이다 — 다만 충돌이 잦아지면 그 버킷 안에서는 결국 리스트를 순회해야 하므로 $O(1)$ 보장이 무너진다.

::: deep 부하율이 높아지면 왜 성능이 떨어지는가
버킷 하나에 원소가 여러 개 걸리면(체인이 길어지면) 그 버킷을 찾은 뒤에도 체인을 순서대로 비교해야 정확한 원소를 찾는다 — 최악의 경우 모든 원소가 버킷 하나에 몰리면 탐색이 $O(n)$으로 퇴화한다. `max_load_factor()`를 낮게 잡으면(예: 0.5) 버킷을 더 일찍, 더 많이 늘려서 체인을 짧게 유지하지만, 그만큼 메모리를 더 쓰고 재해시가 더 자주 일어난다. 기본값 1.0은 이 둘 사이의 절충이다.
:::

## 5. 커스텀 타입을 키로 쓰려면: std::hash 특수화가 필요하다

`unordered_map<std::string, ...>`이 되는 이유는 표준 라이브러리가 이미 `std::hash<std::string>`을 정의해 뒀기 때문이다. 로봇의 조인트를 `(다리 번호, 관절 종류)` 쌍처럼 직접 만든 구조체로 식별하고 싶다면, 그 타입의 해시 함수를 **직접 정의해 줘야** 한다 — 없으면 컴파일이 안 된다.

```cpp title="no_hash_fail.cpp — std::hash 특수화 없이 커스텀 타입을 키로 쓰면"
#include <unordered_map>

struct JointId {
    int leg;
    int joint_type;
    bool operator==(const JointId& other) const {
        return leg == other.leg && joint_type == other.joint_type;
    }
};
// std::hash<JointId> 특수화를 일부러 뺐다

int main() {
    std::unordered_map<JointId, double> angles;
    angles[JointId{1, 0}] = 0.5;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra no_hash_fail.cpp -o no_hash_fail
no_hash_fail.cpp:13:41: error: use of deleted function 'std::unordered_map<...>::unordered_map() [...]'
   13 |     std::unordered_map<JointId, double> angles;
      |                                         ^~~~~~
.../unordered_map.h:148:7: note: '...unordered_map() [...]' is implicitly deleted because the default definition would be ill-formed:
.../hashtable_policy.h:1218:49: error: use of deleted function 'std::hash<JointId>::hash()'
 1218 |       _Hashtable_ebo_helper() noexcept(noexcept(_Tp())) : _Tp() { }
      |                                                 ^~~~~
```

(g++ 13.3 실측 — 실제 에러는 템플릿 계층을 타고 10줄 넘게 이어지지만, 근본 원인은 마지막 줄 `std::hash<JointId>::hash()`가 삭제된 함수라는 것 하나다.) `map`이었다면 `operator<`만 있으면 됐을 자리에, `unordered_map`은 `operator==`와 `std::hash<JointId>` 둘 다 요구한다. `std::hash`의 기본 템플릿은 아무 타입이나 받아 주지 않고, `int`·`std::string` 같은 표준이 정의해 둔 타입에만 특수화가 존재한다 — `JointId`는 그 목록에 없으니 기본 템플릿이 그대로 "호출 불가"로 남는다.

```cpp title="custom_hash.cpp — std::hash<JointId>를 직접 특수화한다"
#include <unordered_map>
#include <functional>

struct JointId {
    int leg;
    int joint_type;   // 0=coxa, 1=femur, 2=tibia
    bool operator==(const JointId& other) const {
        return leg == other.leg && joint_type == other.joint_type;
    }
};

template <>
struct std::hash<JointId> {
    std::size_t operator()(const JointId& id) const noexcept {
        // boost::hash_combine과 같은 관용구 -- 두 필드의 해시를 비트 단위로 섞는다
        std::size_t h1 = std::hash<int>{}(id.leg);
        std::size_t h2 = std::hash<int>{}(id.joint_type);
        return h1 ^ (h2 + 0x9e3779b9 + (h1 << 6) + (h1 >> 2));
    }
};

int main() {
    std::unordered_map<JointId, double> angles;
    angles[JointId{1, 0}] = 0.5;
    angles[JointId{1, 1}] = 1.2;
    angles[JointId{2, 0}] = 0.3;

    auto it = angles.find(JointId{1, 1});
    if (it != angles.end())
        std::cout << "leg=" << it->first.leg << " angle=" << it->second << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra custom_hash.cpp -o custom_hash
$ ./custom_hash
leg=1 angle=1.2
```

(g++ 13.3 실측.) `std::hash<JointId>`를 `std` 네임스페이스 안에 명시적 전체 특수화(`template <> struct std::hash<JointId>`)로 정의하면, 그 순간부터 `JointId`는 `unordered_map`·`unordered_set`의 키로 쓸 수 있는 타입이 된다. `operator()`가 해시값을 계산하는 유일한 요구 사항이고, 서로 다른 필드의 해시를 단순히 더하지 않고 비트 시프트·XOR로 섞는 이유는 각 필드가 좁은 범위(0~2 같은 작은 정수)일 때 단순 덧셈은 충돌이 몰리기 쉽기 때문이다.

::: warn operator==가 없으면 std::hash가 있어도 소용없다
`unordered_map`은 해시값이 같은 원소 둘을 구분하려고 `operator==`도 요구한다(해시 충돌이 나면 결국 값 비교로 실제 같은 키인지 확인해야 한다 — 위 다이어그램의 체인 순회가 바로 이 비교다). `std::hash`만 특수화하고 `operator==`를 빼먹으면 `no_hash_fail.cpp`와 똑같은 계열의 "삭제된 함수" 에러가 `_Equal` 쪽에서 대신 뜬다.
:::

## 6. operator[]의 함정: 조회만 하려 했는데 삽입된다

`map`·`unordered_map` 둘 다 공유하는 가장 위험한 함정은 `operator[]`다. `[]`로 값을 **읽기만** 하려 했는데, 그 키가 없으면 **기본값으로 자동 삽입**해 버린다.

```cpp title="bracket_trap.cpp — 없는 키를 []로 읽기만 했는데 삽입된다"
#include <iostream>
#include <map>
#include <string>

int main() {
    std::map<std::string, double> joint_angles;
    joint_angles["shoulder"] = 1.57;

    std::cout << "size before = " << joint_angles.size() << "\n";
    double angle = joint_angles["elbow"];   // 없는 키 -- 기본값(0.0)으로 자동 삽입된다
    std::cout << "size after read attempt = " << joint_angles.size() << "\n";
    std::cout << "elbow angle (조회만 하려 했는데) = " << angle << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra bracket_trap.cpp -o bracket_trap
$ ./bracket_trap
size before = 1
size after read attempt = 2
elbow angle (조회만 하려 했는데) = 0
```

(g++ 13.3 실측.) `joint_angles["elbow"]`는 그저 값을 읽는 것처럼 보이는 문장이지만, 실제로는 `"elbow"`가 없으면 `double`의 기본값(`0.0`)으로 **그 키를 삽입한 뒤** 그 값의 레퍼런스를 돌려준다. `size`가 1에서 2로 늘어난 게 그 증거다. 존재 여부만 확인하려던 코드가 조용히 컨테이너를 오염시키는, 흔하지만 알아채기 어려운 버그다.

::: danger []는 const 컨테이너에서 아예 컴파일이 안 된다
`operator[]`가 "없으면 삽입한다"는 동작을 하려면 컨테이너를 수정할 수 있어야 한다 — 그래서 `map::operator[]`는 `const` 멤버 함수가 아니다. `const map&`을 받는 함수 안에서 `[]`를 쓰면 그 자리에서 컴파일이 막힌다.

```cpp title="const_bracket_fail.cpp"
void print_angle(const std::map<std::string, double>& joint_angles) {
    std::cout << joint_angles["shoulder"] << "\n";   // const map에 operator[] -- 에러
}
```

```console
$ g++ -std=c++20 -Wall -Wextra const_bracket_fail.cpp -o const_bracket_fail
const_bracket_fail.cpp:6:41: error: passing 'const std::map<std::__cxx11::basic_string<char>, double>' as 'this' argument discards qualifiers [-fpermissive]
    6 |     std::cout << joint_angles["shoulder"] << "\n";
      |                                         ^
```

(g++ 13.3 실측.) 컴파일이 막히는 게 오히려 다행이다 — 런타임에 "읽기만 하는 줄 알았던 코드가 원본을 바꿔 버리는" 사고를 아예 문법 단계에서 차단한다. **`const` 컨테이너를 다루는 함수에서 조회는 항상 `find()`나 `at()`을 써라.**
:::

## 7. 삽입 없이 조회하는 법: find(), count(), contains()

`operator[]`의 함정을 피하려면 "삽입 없이 조회만" 하는 함수로 바꾸면 된다. `find()`는 반복자(없으면 `end()`)를, `count()`는 개수(`map`은 0 또는 1, 멀티맵 계열은 여러 개 가능)를, C++20의 `contains()`는 곧바로 `bool`을 돌려준다.

```cpp title="find_vs_bracket.cpp — const map에서 삽입 없이 조회한다"
void print_angle(const std::map<std::string, double>& joint_angles) {
    auto it = joint_angles.find("elbow");
    if (it != joint_angles.end()) {
        std::cout << "elbow = " << it->second << "\n";
    } else {
        std::cout << "elbow 없음 (읽기 전용이라 자동 삽입되지 않았다)\n";
    }
    std::cout << "count(\"shoulder\") = " << joint_angles.count("shoulder") << "\n";
    std::cout << "contains(\"elbow\") = " << std::boolalpha
              << joint_angles.contains("elbow") << "\n";   // C++20
}
```

```console
$ g++ -std=c++20 -Wall -Wextra find_vs_bracket.cpp -o find_vs_bracket
$ ./find_vs_bracket
elbow 없음 (읽기 전용이라 자동 삽입되지 않았다)
count("shoulder") = 1
contains("elbow") = false
size after print_angle = 1
```

(g++ 13.3 실측. `find_vs_bracket.cpp` 전체는 `const std::map<std::string, double>& joint_angles`를 받는 함수와 이를 호출하는 `main`으로 구성했다.) `find()`·`count()`·`contains()` 셋 다 컨테이너를 전혀 바꾸지 않는다 — `size after print_angle = 1`이 마지막 줄에서 그대로 유지된 게 증거다. **읽기 전용 문맥(특히 `const&` 파라미터)에서는 `[]` 대신 이 셋 중 하나를 습관적으로 써라.** 셋의 차이는 용도다 — 값까지 필요하면 `find()`, 존재 여부만 필요하고 가독성을 우선하면 C++20의 `contains()`, `count()`는 멀티맵/멀티셋과의 인터페이스 일관성을 위해 남아 있는 옛 관용구에 가깝다.

## 8. 로보틱스 도메인: 실시간 제어 루프에서 예측 가능한 쪽을 고른다

ROS 2 파라미터 서버, `tf2`의 프레임 이름 조회, `ros2_control`의 조인트 이름 → 상태 인터페이스 매핑까지, 로봇 소프트웨어 전반에 "이름으로 값을 찾는" 조회가 널려 있다. 평균 속도만 보면 `unordered_map`이 이 절 전체에서 항상 이겼으니 항상 `unordered_map`을 써야 할 것 같지만, [6.8 실시간 제약과 제어 루프](#/realtime)의 관점은 다르다 — 실시간 제어 루프가 신경 쓰는 건 평균이 아니라 **최악의 경우**다.

`unordered_map`의 평균 $O(1)$은 부하율이 낮고 해시가 고르게 퍼질 때의 이야기다. 재해시가 일어나는 그 한 번의 삽입은 버킷 배열 전체를 새로 만들고 기존 원소를 전부 재배치하므로 그 순간만큼은 $O(n)$이다 — 1ms 주기로 도는 제어 루프 안에서 이 재해시가 우연히 걸리면 그 주기만 지터(jitter)가 크게 튄다. `map`의 $O(\log n)$은 최선의 경우도 최악의 경우도 항상 $\log n$이다 — 이 절에서 확인했듯 100만 개에서도 트리 높이는 약 20~40 단계로 항상 예측 가능한 범위 안에 있다. **삽입·삭제가 실행 중에 거의 없고 조회만 반복하는 자리라면 `unordered_map`이 유리하고, 삽입이 실행 중에도 섞여 들어오는 실시간 경로라면 `map`의 일관된 $O(\log n)$이 지터 관점에서 더 안전한 선택이 될 수 있다.** [10.9 ros2_control과 hardware_interface](#/ros2-control)에서 다룰 상태 인터페이스 조회는 대개 제어 루프 시작 전에 한 번만 구성되고 이후로는 삽입 없이 조회만 반복되므로, 이 경우엔 `unordered_map`의 평균 속도 이점을 그대로 누려도 된다 — "항상 `map`"이 아니라 "삽입이 실행 중에도 섞이는가"가 이 선택의 진짜 기준이다.

::: interview map과 unordered_map, 언제 어느 걸 쓰는가
면접에서 자주 나오는 "왜 두 개나 있는가" 질문의 답변 뼈대. ① **내부 구조가 다르다** — `map`은 레드-블랙 트리(libstdc++ 소스 `_Rb_tree`로 실측 확인), `unordered_map`은 해시 테이블(`_Hashtable`)이다. ② **정렬**: `map`은 항상 키 오름차순으로 순회되고, `unordered_map`은 순서 보장이 없다(이 절 `order_demo.cpp` 실측). ③ **속도**: 탐색은 `map`이 $O(\log n)$, `unordered_map`이 평균 $O(1)$이다 — 100만 건 기준 탐색 1회 평균이 `map` 995.0ns, `unordered_map` 39.2ns로 약 25배 차이 났다(이 절 `bench.cpp` 실측). ④ **최악의 경우**: `unordered_map`은 재해시가 걸리면 그 순간 $O(n)$이 되고, `map`은 항상 $O(\log n)$으로 균일하다 — 이 예측 가능성 때문에 실시간 제어 루프에서는 `map`을 고르는 게 정당화될 수 있다. ⑤ **커스텀 키**: `map`은 `operator<`만 있으면 되지만 `unordered_map`은 `operator==`와 `std::hash` 특수화가 둘 다 필요하다.
:::

::: hist 왜 C++11에서야 unordered_map이 추가됐나
`std::map`은 C++98부터 있었지만 `unordered_map`은 C++11에서야 표준에 들어왔다. 해시 테이블 자체는 그전에도 SGI STL의 `hash_map`처럼 비표준 확장으로 여러 구현체가 제공했지만, 표준이 정식으로 채택하지 못한 이유는 해시 함수·충돌 처리·버킷 인터페이스 같은 세부 사항에 대한 합의가 오래 걸렸기 때문이다. C++11 위원회는 `bucket_count()`·`load_factor()`·`std::hash` 특수화 메커니즘까지 함께 표준화해, 이 절에서 실측한 인터페이스 전체가 그때 확정됐다.
:::

## 요약

- `std::map`/`std::set`은 레드-블랙 트리, `std::unordered_map`/`std::unordered_set`은 해시 테이블로 구현된다 — libstdc++ 헤더에서 각각 `_Rb_tree`, `_Hashtable`로 실측 확인했다.
- `map`은 항상 키 오름차순으로 순회되고, `unordered_map`은 순서 보장이 없다(실측: `order_demo.cpp`).
- 탐색 속도는 100만 건 기준 `map` 995.0ns, `unordered_map` 39.2ns로 약 25배 차이 났다(실측: `bench.cpp`, `-O2`). 삽입은 약 2.8배 차이로 탐색보다 격차가 작다.
- 해시 테이블은 해시값을 버킷 개수로 나눈 나머지로 원소를 분배한다 — 같은 버킷에 원소가 몰리는 게 해시 충돌이고, `bucket_count()`/`load_factor()`로 그 상태를 직접 관찰할 수 있다(실측: `bucket_demo.cpp`).
- 커스텀 타입을 `unordered_map`의 키로 쓰려면 `operator==`와 `std::hash<T>` 특수화가 둘 다 필요하다 — 빠뜨리면 "삭제된 함수" 계열의 컴파일 에러가 난다(실측: `no_hash_fail.cpp`).
- `operator[]`는 없는 키에 접근하면 기본값으로 **자동 삽입**한다 — 조회만 하려던 코드가 컨테이너를 오염시킨다(실측: `bracket_trap.cpp`). `const` 컨테이너에서는 `[]` 자체가 컴파일 에러다(실측: `const_bracket_fail.cpp`).
- 삽입 없이 조회만 하려면 `find()`/`count()`/`contains()`(C++20)를 쓴다(실측: `find_vs_bracket.cpp`).
- 실시간 제어 루프처럼 최악의 경우가 중요한 자리에서는 `unordered_map`의 재해시로 인한 순간적 $O(n)$보다 `map`의 일관된 $O(\log n)$이 더 예측 가능한 선택일 수 있다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일해서 확인하는 실습이다.

1. `std::map`과 `std::unordered_map`의 내부 구조 차이를 한 문장으로 설명하고, 그 차이가 순회 순서에 어떻게 반영되는지 써라.

2. `joint_angles["elbow"]`를 조회만 할 목적으로 썼는데 실제로 컨테이너가 바뀌는 이유를 설명하고, 이 문제를 피하는 방법 두 가지를 제시하라.

3. (실습, 코드 작성형) `custom_hash.cpp`를 그대로 타이핑하되, `std::hash<JointId>` 특수화 블록 전체를 주석 처리하고 다시 컴파일해 봐라. 성공 기준: `no_hash_fail.cpp`와 같은 계열의 "삭제된 함수" 에러가 재현되고, 에러 메시지 안에서 `std::hash<JointId>`가 언급된 줄을 찾아낸다.

4. (실습) `bench.cpp`를 그대로 타이핑하고 `N`을 10,000으로 낮춰서 다시 재라. 성공 기준: `map`과 `unordered_map`의 탐색 시간 차이(배율)가 이 절의 100만 건 기준(약 25배)보다 작아지는지, 커지는지를 직접 측정해서 답한다.

5. (실습) `bucket_demo.cpp`를 그대로 타이핑하고, 100개 대신 10,000개를 추가로 삽입하도록 고쳐서 다시 실행하라. 성공 기준: `bucket_count()`가 몇 차례 더 늘어나는지, 최종 `load_factor()`가 1.0을 넘지 않는지 직접 확인한다.
:::

::: answer 해설
1. `map`은 레드-블랙 트리, `unordered_map`은 해시 테이블이다. 트리는 키 크기 비교로 왼쪽/오른쪽을 정하므로 중위 순회가 자동으로 오름차순이 되고, 해시 테이블은 해시값의 나머지로 버킷을 정하므로 키의 크기와 무관한 순서로 나온다.
2. `map`/`unordered_map`의 `operator[]`는 키가 없으면 그 키를 기본값으로 삽입한 뒤 그 값의 레퍼런스를 돌려주도록 정의돼 있다 — "삽입 아니면 조회"가 아니라 "조회 아니면 삽입 후 조회"다. 피하는 방법: `find()`로 반복자를 확인한 뒤 필요할 때만 값을 읽거나, C++20의 `contains()`로 존재 여부만 확인한다.
3. `std::hash<JointId>` 특수화를 주석 처리하면 `unordered_map<JointId, double>`의 기본 생성자 자체가 암묵적으로 삭제되어, `no_hash_fail.cpp`에서 본 것과 같은 "use of deleted function ... std::hash<JointId>::hash()" 계열 에러가 그대로 재현된다.
4. N이 작아지면 트리 높이($\log_2 10{,}000 \approx 13.3$)와 해시 테이블의 평균 접근 비용 차이가 절대 시간 기준으로는 더 작아지지만, 상수 배율 자체는 캐시 적중률이 오히려 좋아지는 쪽(둘 다 데이터가 캐시에 다 들어갈 만큼 작아짐)으로 인해 이 절의 100만 건 실측보다 배율이 줄어드는 경향이 있다 — 직접 측정한 숫자로 확인해야 하는 이유가 여기 있다.
5. 10,000개를 추가하면 부하율이 1.0을 넘으려 할 때마다 libstdc++가 버킷 개수를 소수(prime) 기준으로 계속 불려서(13 → 127 → ... ) 항상 `load_factor() <= max_load_factor()`(기본 1.0)를 유지한다 — 재해시 횟수는 `bucket_count()`가 몇 번 바뀌는지 로그를 찍어 직접 세어 보면 확인된다.
:::

이 절의 `order_demo.cpp`, `bench.cpp`, `bucket_demo.cpp`, `custom_hash.cpp`, `no_hash_fail.cpp`, `bracket_trap.cpp`, `const_bracket_fail.cpp`, `find_vs_bracket.cpp`를 전부 직접 타이핑해라. 특히 `bench.cpp`는 `-O2`로 컴파일해야 이 절의 수치와 비슷한 결과가 나온다 — `-O0`으로 재면 두 컨테이너 다 훨씬 느려지고 격차의 절대값도 달라진다. 기준 명령: `g++ -std=c++20 -Wall -Wextra -O2 파일.cpp -o 이름 && ./이름`.

**다음 절**: [5.3 deque, list, array](#/seq-containers) — map/set 계열이 "키로 찾는" 문제를 풀었다면, 다음 절은 다시 인덱스 기반 컨테이너로 돌아와 `deque`·`list`·`array`가 `vector`와 어떻게 다르고, 실무에서 `vector`가 아닌 것을 골라야 하는 경우가 얼마나 드문지를 실측으로 확인한다.
