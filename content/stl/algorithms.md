# 5.5 <algorithm> 완전 정복

::: lead
[5.2](#/assoc-containers)와 [5.3](#/seq-containers)은 컨테이너가 원소를 어떻게 저장하는지를 다뤘다. 이 절은 그 원소를 가지고 실제로 무엇을 하는지 — 찾고, 정렬하고, 바꾸고, 합산하고, 걸러내는 일 — 를 다룬다. C++로 이 일을 하는 방법은 두 가지다. `for` 루프를 직접 짜거나, `<algorithm>`이 제공하는 함수를 부르거나. 이 절은 후자를 고르라고 말하는 절이다 — 그것도 "더 짧아 보여서"가 아니라, 코드를 읽는 사람에게 의도가 더 빨리 전달되고, 실제로 재 보면 손으로 짠 루프보다 느리지 않다는 두 가지 근거를 실측으로 댈 것이다.
:::

## 1. 손으로 짠 루프가 숨기는 것: 의도

다음 두 코드는 정확히 같은 일을 한다 — 벡터에서 1.0을 넘는 첫 원소를 찾는다.

```cpp title="raw_loop.cpp — 손으로 짠 탐색 루프"
double* found = nullptr;
for (auto& j : joints) {
    if (j.angle_rad > 1.0) {
        found = &j.angle_rad;
        break;
    }
}
```

```cpp title="find_if_version.cpp — std::find_if로 같은 일을"
auto it = std::find_if(joints.begin(), joints.end(),
                        [](const JointState& j) { return j.angle_rad > 1.0; });
```

`raw_loop.cpp`를 읽는 사람은 `for`, `if`, `break`, 초기화된 포인터 네 가지 문법 조각을 순서대로 조립해서 "아, 이건 뭔가를 찾는 코드구나"라고 **추론**해야 한다. 조건이 복잡해지거나 중간에 다른 코드가 끼어들면 이 추론은 더 오래 걸리고, 종료 조건을 실수로 빼먹는 버그(`break`를 안 넣어 계속 도는 것, 찾고도 계속 순회하는 것)가 끼어들 자리도 넓어진다. `find_if_version.cpp`는 함수 이름 자체가 "찾는다(find)"와 "조건에 따라(if)"를 이미 말하고 있다 — 읽는 사람은 조립할 필요 없이 이름을 그대로 받아들이면 된다. 이건 사소한 가독성 취향이 아니다. **표준 알고리즘의 이름은 의도를 코드에 남기는 주석이자 동시에 실행 가능한 코드다.** `std::sort`라고 쓰인 줄을 보고 "정렬하는구나"를 추론할 필요는 없다.

::: note <algorithm>이 요구하는 건 반복자 범위뿐이다
`std::find_if(joints.begin(), joints.end(), ...)`는 `joints`가 `vector`인지 `deque`인지 몰라도 된다 — `begin()`과 `end()`가 반환하는 반복자 쌍만 있으면 된다. 이 설계 덕분에 알고리즘은 컨테이너 종류를 가리지 않고 재사용된다. 이 절 8번에서 이 설계를 정식으로 다룬다.
:::

의도 전달이 알고리즘을 쓸 첫 번째 이유라면, 두 번째 이유는 성능이다 — "표준 라이브러리는 범용이라 느릴 것"이라는 짐작이 맞는지, 실제로 재서 확인한다.

## 2. std::sort: 실측으로 손 퀵정렬·버블정렬과 겨룬다

`std::sort`는 표준이 정확한 알고리즘을 지정하지 않고 평균 시간 복잡도만 요구했지만, 실무에서 쓰이는 구현은 거의 전부 **도입정렬(introsort)**이다 — 퀵정렬로 시작해서, 재귀 깊이가 $2\log_2 n$을 넘으면(퀵정렬이 최악의 경우로 빠졌다는 신호) 힙정렬로 전환하고, 남은 구간이 충분히 작아지면(libstdc++는 16개 이하) 삽입정렬로 마무리하는 하이브리드다. 이 조합이 퀵정렬 하나만 쓸 때의 약점(최악의 경우 $O(n^2)$)을 힙정렬의 항상-보장-$O(n \log n)$으로 덮고, 작은 구간에서는 삽입정렬이 실제로 더 빠르다는 사실(원소가 몇 개 안 남으면 오버헤드가 비교 자체보다 커진다)까지 챙긴다 — 그래서 표준은 `std::sort`에 **최악의 경우까지 포함해 $O(n \log n)$**을 보장한다.

```cpp title="sort_compare.cpp — std::sort vs 손으로 짠 퀵정렬(대용량), std::sort vs 손 버블정렬(소용량)"
#include <algorithm>
#include <chrono>
#include <random>
#include <vector>

void quicksort(std::vector<int>& v, int lo, int hi) {
    if (lo >= hi) return;
    int pivot = v[(lo + hi) / 2];
    int i = lo, j = hi;
    while (i <= j) {
        while (v[i] < pivot) ++i;
        while (v[j] > pivot) --j;
        if (i <= j) { std::swap(v[i], v[j]); ++i; --j; }
    }
    quicksort(v, lo, j);
    quicksort(v, i, hi);
}

void bubblesort(std::vector<int>& v) {
    for (std::size_t i = 0; i < v.size(); ++i)
        for (std::size_t j = 0; j + 1 < v.size() - i; ++j)
            if (v[j] > v[j + 1]) std::swap(v[j], v[j + 1]);
}
// main()은 무작위 int로 두 벡터를 채운 뒤 std::sort/quicksort/bubblesort를 각각 재고
// std::is_sorted와 결과 동등성까지 검증한다 (전체 코드는 파일로 타이핑해서 확인)
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 sort_compare.cpp -o sort_compare
$ ./sort_compare
N=2000000
  std::sort       : 155.109 ms
  hand quicksort  : 180.729 ms
  결과 일치       : true
N=20000
  std::sort       : 1.05216 ms
  hand bubblesort : 438.227 ms
  결과 일치       : true
```

(g++ 13.3 / `-O2` / Linux x86-64 실측. 세 번 반복 실행에서 `std::sort` 200만 건은 152.3~155.1ms, 손 퀵정렬은 180.7ms 안팎으로 거의 고정, `std::sort` 2만 건은 1.05~1.16ms, 손 버블정렬은 436.6~439.4ms 사이로 흔들렸다.) 200만 개짜리 무작위 정수에서 `std::sort`는 손으로 짠 교과서적 퀵정렬보다 **더 빨랐다** — 약 14~17% 빠르다. 같은 알고리즘 계열인데도 이 차이가 나는 이유는 `std::sort`가 순수 퀵정렬이 아니라 도입정렬이기 때문이다 — 재귀가 얕아지는 구간에서 삽입정렬로 전환해 손 퀵정렬이 계속 재귀 오버헤드를 무는 지점에서 이득을 챙긴다. 버블정렬과의 비교는 애초에 승부가 안 된다 — $O(n^2)$ 알고리즘은 2만 개에서도 $O(n \log n)$보다 **400배 넘게** 느리다.

::: perf "표준 라이브러리라 느릴 것"이라는 가정이 왜 틀리는가
표준 라이브러리 알고리즘은 범용 인터페이스(임의 반복자, 임의 비교자)를 위해 설계됐지만, 그 범용성이 런타임 오버헤드로 이어지지는 않는다 — 비교자·반복자 연산이 전부 템플릿으로 컴파일 타임에 인라인되기 때문이다(제로 오버헤드 원칙, [4.1](#/function-templates) 참고). 이 실측에서 `std::sort`가 손 코드보다 **느리지 않고 오히려 빠른** 이유는 표준 라이브러리 구현자가 도입정렬 같은 하이브리드 전략을 이미 다듬어 뒀기 때문이다 — 개별 애플리케이션 코드에서 매번 이 수준으로 다듬을 이유가 없다.
:::

::: deep 도입정렬이 세 알고리즘을 섞는 이유
퀵정렬은 평균은 빠르지만 피벗이 계속 나쁘게 뽑히면(이미 정렬된 데이터에 첫/마지막 원소를 피벗으로 쓰는 구현이 대표적 함정이다) 재귀가 $n$단계까지 깊어져 $O(n^2)$으로 무너진다. 도입정렬은 재귀 깊이에 상한(대개 $2\log_2 n$)을 정해 두고, 그 상한을 넘는 순간 "이 구간은 퀵정렬이 불리하게 빠졌다"고 판단해 힙정렬로 갈아탄다 — 힙정렬은 최악의 경우에도 항상 $O(n \log n)$이라 상한을 보장하는 안전망 역할을 한다. 마지막으로 원소가 충분히 적어지면(libstdc++ 기준 16개) 삽입정렬로 바꾸는데, 삽입정렬은 점근적으로는 $O(n^2)$이지만 원소가 적을 때는 비교·교환 자체의 오버헤드가 낮아 실제로 더 빠르다 — 점근 복잡도가 전부가 아니라는 걸 표준 라이브러리 구현 자체가 보여 준다.
:::

## 3. std::find와 std::find_if: 값 vs 조건

`std::find`는 정확히 일치하는 값 하나를 찾고, `std::find_if`는 술어(predicate)가 참인 첫 원소를 찾는다. 이미 위에서 `find_if`를 봤으니, 여기서는 `find`까지 나란히 짚는다.

```cpp title="find_demo.cpp — find_if(조건)와 find(값)"
#include <algorithm>
#include <vector>

struct JointState { std::string name; double angle_rad; };

std::vector<JointState> joints{
    {"coxa_1", 0.12}, {"femur_1", -0.55}, {"tibia_1", 1.02},
    {"coxa_2", 0.30}, {"femur_2", -0.48}, {"tibia_2", 0.95}};

auto it = std::find_if(joints.begin(), joints.end(),
                        [](const JointState& j) { return j.angle_rad > 1.0; });

std::vector<int> ids{10, 20, 30, 40};
auto it2 = std::find(ids.begin(), ids.end(), 30);
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 find_demo.cpp -o find_demo
$ ./find_demo
1.0 rad 초과 첫 조인트: tibia_1 = 1.02
id 30 찾음: true
```

(g++ 13.3 실측.) `std::find`가 정렬 여부와 무관하게 항상 선형 탐색인 이유는 반복자 범위가 요구하는 최소 조건이 순회 하나뿐이기 때문이다 — 정렬된 데이터라면 [5.2](#/assoc-containers)에서 다룬 로그 탐색 컨테이너를 쓰거나, 정렬된 `vector`라면 뒤에서 다룰 `std::lower_bound`류(이진 탐색 알고리즘, 이 절 범위 밖) 쪽이 낫다. **"찾는다"는 목적이 같아도 데이터의 사전 조건(정렬 여부)에 따라 고를 도구가 달라진다** — `find`는 아무 조건도 없을 때의 기본값이다.

## 4. std::transform: 원소 하나하나를 다른 값으로 바꾼다

`std::transform`은 입력 범위의 각 원소에 함수를 적용해 출력 범위에 채워 넣는다. 센서 raw 값을 물리 단위로 바꾸는 변환이 전형적인 예다.

```cpp title="transform_demo.cpp — IMU raw count를 m/s^2로 스케일 변환"
#include <algorithm>
#include <vector>

std::vector<int> raw_counts{100, 250, -80, 4096, 0, -4096};
std::vector<double> accel_mps2(raw_counts.size());

constexpr double SCALE = 9.81 / 4096.0;  // 4096 count = 1g 가정
std::transform(raw_counts.begin(), raw_counts.end(), accel_mps2.begin(),
                [](int count) { return count * SCALE; });
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 transform_demo.cpp -o transform_demo
$ ./transform_demo
100 count -> 0.239502 m/s^2
250 count -> 0.598755 m/s^2
-80 count -> -0.191602 m/s^2
4096 count -> 9.81 m/s^2
0 count -> 0 m/s^2
-4096 count -> -9.81 m/s^2
```

(g++ 13.3 실측.) `raw_loop.cpp`로 이 변환을 짰다면 `for (std::size_t i = 0; i < raw_counts.size(); ++i) accel_mps2[i] = raw_counts[i] * SCALE;` 정도가 될 텐데, 이 버전은 인덱스 변수 `i`가 입력·출력 두 벡터 모두에 대해 범위를 벗어나지 않는지를 작성자가 매번 스스로 보장해야 한다. `std::transform`은 입력 범위(`begin`/`end`)와 출력 시작점(`accel_mps2.begin()`)만 받고 내부에서 그 대응을 관리하므로, 인덱스를 잘못 계산해 범위를 벗어나는 실수의 여지가 그만큼 줄어든다. 출력 이터레이터는 입력과 같은 컨테이너의 같은 자리(제자리 변환)여도 되고, 다른 컨테이너여도 된다 — 이 절 8번에서 보듯 반복자 하나로 추상화된 결과다.

## 5. std::accumulate와 std::reduce: 순차 합산과 병렬화 가능성

`std::accumulate`(C++98부터)는 초기값에서 시작해 범위를 **왼쪽에서 오른쪽으로, 순서대로** 접어 나간다 — 이 순서 보장 때문에 뺄셈처럼 결합 법칙이 깨지는 연산에도 안전하게 쓸 수 있지만, 그 순서 보장 자체가 병렬화를 막는다. C++17의 `std::reduce`는 정확히 같은 합산을 하되 **원소를 어떤 순서로 묶어 계산해도 좋다**는 것만 요구한다 — 덧셈처럼 결합·교환 법칙이 성립하는 연산이라면 결과는 같고, 그 순서 자유가 실행을 여러 조각으로 나눠 동시에 계산할 여지를 만든다. `std::reduce`에 실행 정책(`std::execution::par`)을 붙이면 이 여지가 실제 스레드 병렬화로 이어진다 — 그 실측은 다음 6번으로 넘긴다.

```cpp title="accumulate_reduce.cpp — accumulate vs reduce(순차) vs reduce(par)"
#include <execution>
#include <numeric>
#include <vector>

std::vector<double> readings(50'000'000);
// readings를 -1.0~1.0 균등분포로 채운 뒤 세 가지로 합산

double sum_acc        = std::accumulate(readings.begin(), readings.end(), 0.0);
double sum_reduce_seq = std::reduce(readings.begin(), readings.end(), 0.0);
double sum_reduce_par = std::reduce(std::execution::par, readings.begin(), readings.end(), 0.0);
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 accumulate_reduce.cpp -o accumulate_reduce
$ ./accumulate_reduce
N=50000000
accumulate           : 104.321 ms, sum=3083.19
reduce (순차)        : 50.9076 ms, sum=3083.19
reduce (par)         : 50.2062 ms, sum=3083.19
```

(g++ 13.3 / `-O2` / Linux x86-64 4코어, **이 환경에 libtbb가 설치되지 않은 상태**에서 실측.) 세 값 모두 동일한 `sum=3083.19`로 일치한다 — 순서를 바꿔도 결과가 같다는 결합 법칙이 여기서는 성립하기 때문이다(부동소수점 덧셈은 엄밀히는 결합 법칙이 깨질 수 있지만, 이 실측 범위에서는 출력 자릿수 안에서 차이가 드러나지 않았다). 순차 `accumulate`(104.3ms)보다 순차 `reduce`(50.9ms)가 이미 약 2배 빠른데, 이는 병렬화가 아니라 `reduce`가 내부적으로 벡터화하기 쉬운 형태로 루프를 풀 수 있어서다(둘 다 아직 한 스레드에서 실행됐다). 그런데 `reduce (par)`가 `reduce (순차)`와 **거의 같은 시간(50.2ms)**이 나왔다 — 병렬 실행 정책을 붙였는데 병렬 실행의 효과가 전혀 없다. 이유는 다음 항목에서 정직하게 확인한다.

::: warn std::execution::par를 붙였다고 항상 병렬로 도는 게 아니다
libstdc++는 C++17 실행 정책을 실제 멀티스레드로 구현하기 위해 내부적으로 인텔 oneTBB 라이브러리를 백엔드로 쓴다. 이 환경처럼 `libtbb`(또는 `libtbb-dev`)가 시스템에 없으면, `std::execution::par`가 붙은 호출은 **컴파일·링크 에러 없이** 조용히 순차 실행으로 대체된다 — 위 실측에서 `reduce (par)`가 `reduce (순차)`와 같은 시간이 나온 게 바로 이 대체의 증거다. 실행 정책은 "이렇게 실행해도 좋다"는 허가이지 "이렇게 실행해야 한다"는 강제가 아니다 — 표준은 구현이 병렬 실행을 제공하지 않고 순차로 처리해도 위반이 아니라고 허용한다.
:::

## 6. 실행 정책(execution policy)을 실제로 병렬화하려면

C++17의 실행 정책은 `std::execution::seq`(순차, 기본과 동일), `std::execution::par`(병렬, 여러 스레드), `std::execution::par_unseq`(병렬 + 벡터화까지 허용) 세 가지를 제공한다. 앞 절에서 `par`가 조용히 순차로 대체되는 걸 봤으니, 이번엔 `libtbb-dev`를 실제로 설치한 뒤 같은 코드를 다시 재서 무엇이 달라지는지 확인한다.

```console
$ sudo apt install libtbb-dev
$ g++ -std=c++20 -Wall -Wextra -O2 accumulate_reduce.cpp -o accumulate_reduce
/usr/bin/ld: ...: undefined reference to `tbb::detail::r1::allocate(...)'
/usr/bin/ld: ...: undefined reference to `tbb::detail::r1::spawn(...)'
collect2: error: ld returned 1 exit status
```

(Ubuntu 24.04 / g++ 13.3 실측.) `libtbb-dev`를 설치하고 나니 상황이 정반대로 뒤집혔다 — 이번엔 **링크 자체가 실패한다.** `libtbb-dev`가 없을 때는 컴파일러가 TBB 백엔드를 아예 쓰지 않는 코드를 생성해 조용히 순차로 넘어갔지만, `libtbb-dev`가 설치돼 TBB 헤더가 보이는 순간부터는 컴파일러가 실제 TBB 심볼을 요구하는 코드를 생성한다 — 이제는 `-ltbb`를 명시적으로 링크해야 한다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 accumulate_reduce.cpp -o accumulate_reduce -ltbb
$ ./accumulate_reduce
N=50000000
accumulate           : 105.299 ms, sum=3083.19
reduce (순차)        : 52.3322 ms, sum=3083.19
reduce (par)         : 18.854 ms, sum=3083.19
```

(g++ 13.3 / `-O2` / Linux x86-64 4코어, `-ltbb` 링크 후 실측. 세 번 반복 실행에서 `reduce(순차)`는 52.3~54.0ms, `reduce(par)`는 16.7~18.9ms 사이로 흔들렸다.) `-ltbb`를 붙이자 `reduce (par)`가 순차 대비 약 **2.8~3.2배** 빨라졌다 — 이 환경의 물리 코어 수(4개)에 근접한 배율이다. `std::sort`도 똑같이 실행 정책을 받는다.

```cpp title="sort_par.cpp — std::sort에 execution::par를 붙인다"
#include <algorithm>
#include <execution>
#include <vector>

// base를 2000만 개짜리 무작위 int로 채운 뒤 각각 sort
std::sort(a.begin(), a.end());                          // 순차
std::sort(std::execution::par, b.begin(), b.end());      // 병렬
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 sort_par.cpp -o sort_par -ltbb
$ ./sort_par
N=20000000
std::sort (순차)              : 1771.4 ms
std::sort(execution::par)     : 633.444 ms
결과 일치: true
```

(g++ 13.3 / `-O2` / Linux x86-64 4코어, `-ltbb` 링크 후 실측. 세 번 반복 실행에서 순차는 1766.2~1788.7ms, 병렬은 623.3~639.5ms로 항상 약 2.8배 배율을 유지했다.) 2천만 개 정렬이 병렬 실행 정책 하나로 약 **2.8배** 빨라졌다 — 정렬 결과(`결과 일치: true`)는 순차와 완전히 같다. 병렬 정책은 결과의 정확성을 바꾸지 않고 실행 시간만 바꾼다.

::: danger 이 절의 -ltbb 결론은 이 환경에 한정된다
이 절의 실측은 g++ 13.3 / libstdc++ / Ubuntu 24.04 x86-64 한 환경의 결과다. 실행 정책을 병렬로 실제 돌리려면 **네 IDE 환경에서 먼저 `libtbb-dev`가 설치돼 있는지, `-ltbb` 링크가 필요한지, 몇 배의 배율이 나오는지를 직접 확인해야 한다** — 다른 컴파일러(clang+libc++)나 다른 배포판은 병렬 백엔드 구현 자체가 다를 수 있고, 코어 수가 다르면 배율도 달라진다. "실행 정책을 붙이면 빨라진다"를 검증 없이 믿지 마라 — 이 절의 5번 실측이 보여주듯 조용히 아무 효과도 없을 수 있다.
:::

## 7. erase-remove idiom: remove가 왜 컨테이너를 안 줄이는가

`std::remove`/`std::remove_if`는 이름과 반대로 **원소를 지우지 않는다.** 지울 대상이 아닌 원소들을 앞으로 밀어 채우고, "여기부터는 이제 의미 없는 값"이라는 새 논리적 끝을 반복자로 돌려줄 뿐이다 — 컨테이너의 `size()`는 그대로다.

```cpp title="remove_only.cpp — remove_if 호출 직후에도 size가 그대로임을 확인"
#include <algorithm>
#include <vector>

std::vector<int> v{1, -2, 3, -4, 5, -6, 7};
auto new_end = std::remove_if(v.begin(), v.end(), [](int x) { return x < 0; });
// v.size()는 아직 7 -- 이 시점에서 v를 그대로 순회하면 뒤쪽에 "쓰레기"가 남아 있다
v.erase(new_end, v.end());   // 진짜로 지우는 두 번째 단계
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 remove_only.cpp -o remove_only
$ ./remove_only
제거 전 size=7
remove_if 호출 직후 size=7 (그대로!)
원소 내용: 1 3 5 7 5 -6 7 
새 논리적 끝까지 거리 = 4
erase까지 마친 뒤 size=4
원소 내용: 1 3 5 7 
```

(g++ 13.3 실측.) `remove_if` 호출 직후 `size()`는 여전히 **7**이고, 원소 내용을 그대로 출력하면 `1 3 5 7`(살아남은 값) 뒤에 `5 -6 7`(뒤섞인 옛 값의 잔재)이 그대로 붙어 있다 — 이게 "지우지 않고 밀어 채운다"는 말의 실체다. `new_end`가 가리키는 지점부터 `end()`까지가 "이제 의미 없는 구간"이고, 그 구간을 진짜로 없애는 건 컨테이너의 멤버 함수인 `erase(new_end, v.end())`뿐이다. `remove`/`remove_if`가 컨테이너를 직접 건드리지 못하는 이유는 이 함수들이 반복자 범위만 받는 알고리즘이라서 그 범위가 어느 컨테이너에서 왔는지조차 모르기 때문이다(8번 참고) — `erase`는 그 컨테이너의 멤버 함수라야만 실제 크기를 바꿀 수 있다. `remove`와 `erase`를 함께 쓰는 이 두 줄이 **erase-remove idiom**이다.

::: interview "remove_if를 불렀는데 size가 안 줄어드는 이유는?"
알고리즘과 컨테이너의 관계를 아는지 확인하는 전형적 질문. 답변 뼈대: ① `std::remove_if`는 `<algorithm>`의 함수이고 반복자 범위만 받는다 — 자신이 어느 컨테이너에서 왔는지 모르므로 컨테이너를 줄일 권한 자체가 없다. ② 실제로 하는 일은 "지울 원소"를 뒤로, "남길 원소"를 앞으로 밀어 채우고 새 논리적 끝의 반복자를 돌려주는 것뿐이다(이 절 실측: `remove_if` 직후 `size()`는 그대로 7). ③ 진짜로 크기를 줄이려면 컨테이너의 멤버 함수 `erase(new_end, end())`를 이어 불러야 한다 — 이 두 단계를 합쳐 erase-remove idiom이라 부른다. ④ C++20의 `std::erase_if`는 이 두 단계를 표준 라이브러리 안에서 하나로 묶어, 호출자가 idiom 자체를 몰라도 되게 만들었다.
:::

## 8. C++20 std::erase_if: idiom을 함수 호출 하나로

C++20은 컨테이너별 `erase`/`erase_if` 자유 함수를 표준에 추가했다. `<vector>`에 정의된 `std::erase_if(vector&, pred)`를 부르면 `remove_if` + `erase` 두 줄이 한 줄로 줄어든다.

```cpp title="erase_if_demo.cpp — C++20: 같은 결과를 함수 호출 하나로"
#include <algorithm>
#include <vector>

std::vector<int> v{1, -2, 3, -4, 5, -6, 7};
std::erase_if(v, [](int x) { return x < 0; });  // remove_if + erase를 한 번에
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 erase_if_demo.cpp -o erase_if_demo
$ ./erase_if_demo
제거 전 size=7
erase_if 호출 후 size=4
원소 내용: 1 3 5 7 
```

(g++ 13.3 실측.) `remove_only.cpp`에서는 `size`가 7에서 그대로였다가 `erase`를 한 번 더 불러야 4가 됐는데, 여기서는 `std::erase_if` 한 줄로 곧바로 **4**가 된다 — 결과는 완전히 같지만 두 단계를 알고리즘 따로, 컨테이너 멤버 함수 따로 호출할 필요가 없어졌다. 다만 `std::erase_if`는 `vector`·`list`·`map`·`unordered_map` 등 표준 컨테이너 각각에 대해 개별적으로 오버로드된 자유 함수다 — 커스텀 컨테이너 타입에는 자동으로 적용되지 않고, 여전히 `remove_if` + `erase`를 직접 짜야 한다.

## 9. 반복자 범위 위에서 동작한다는 설계

이 절 전체에서 본 함수들 — `find_if`, `sort`, `transform`, `accumulate`, `remove_if` — 는 전부 `(begin, end)` 또는 그 변형(`transform`의 출력 시작점, `accumulate`의 초기값)만 받는다. 컨테이너 타입 자체를 매개변수로 받지 않는다는 게 핵심이다. `std::vector<int>`든 `std::deque<double>`든 `std::array<char, 8>`이든, 반복자가 알고리즘이 요구하는 카테고리(예: `std::sort`는 임의 접근 반복자, `std::find`는 입력 반복자면 충분)만 만족하면 같은 알고리즘 함수 하나로 전부 처리된다 — 컨테이너 종류마다 `find_in_vector`, `find_in_deque`를 따로 만들 필요가 없다. 이 설계(알고리즘과 컨테이너를 반복자로 분리하는 것)가 STL을 "몇 개의 컨테이너 × 몇 개의 알고리즘"이 아니라 "컨테이너 개수 + 알고리즘 개수"의 조합으로 완결시킨다. 반복자 카테고리별로 어떤 알고리즘을 쓸 수 있는지, 그리고 알고리즘 도중 반복자가 무효화될 수 있는 경우(예: 컨테이너를 알고리즘 콜백 안에서 수정하는 것)의 정확한 규칙은 [5.4 반복자와 무효화 규칙](#/iterators)에서 컨테이너 전체를 통틀어 정리한다.

## 10. 로보틱스 도메인: 센서 파이프라인과 포인트클라우드

로봇 소프트웨어에서 센서 처리는 거의 항상 "원시값을 걸러서 → 변환하고 → 합산하거나 정렬한다"는 패턴을 반복한다. IMU 파이프라인이라면 `std::transform`으로 raw count를 물리 단위로 바꾸고(이 절 4번), `std::accumulate`나 `std::reduce`로 여러 샘플의 평균을 내는(5~6번) 조합이 그대로 들어맞는다 — 샘플 수가 수만 개 단위로 커지는 포인트클라우드 처리([11.6 PCL로 포인트클라우드 다루기](#/pcl))에서는 이 필터링·합산 비용이 실시간 처리 여부를 가르는 병목이 되고, 그 자리가 정확히 6번에서 확인한 실행 정책(`std::execution::par`)이 실제로 값을 내는 지점이다. 정렬 계열에서는 `std::sort` 자체보다 `std::nth_element`(전체를 정렬하지 않고 k번째로 작은 원소만 제자리에 놓는 부분 정렬 알고리즘, 이 절 범위 밖)가 더 실전적인 선택일 때가 많다 — 포인트클라우드에서 최근접 이웃 k개만 필요하거나 거리 분포의 중앙값(median) 하나만 필요할 때, 전체를 $O(n \log n)$으로 정렬하는 대신 `nth_element`의 평균 $O(n)$으로 끝낼 수 있다. `erase_if`(7번)는 거리·강도 기준으로 이상치 포인트를 걸러내는 전처리에 그대로 쓰인다 — "조건에 안 맞는 포인트를 지운다"는 의도가 `std::erase_if(cloud, is_outlier)` 한 줄에 그대로 드러난다.

## 요약

- 표준 알고리즘은 이름 자체가 의도를 전달한다 — `find_if`를 보고 "찾는다"를 추론할 필요가 없다. 이게 손으로 짠 루프 대비 가장 큰 이득이다.
- `std::sort`는 도입정렬(퀵정렬 + 힙정렬 안전망 + 삽입정렬 마무리)이라 최악의 경우까지 $O(n \log n)$을 보장한다 — 실측으로 손 퀵정렬보다 14~17% 빨랐고, 손 버블정렬보다 400배 넘게 빨랐다(`sort_compare.cpp`).
- `std::find`/`std::find_if`는 정렬 여부와 무관한 선형 탐색이다. `std::transform`은 입력 범위를 함수로 매핑해 출력 범위에 채운다.
- `std::accumulate`(순서 보장, 병렬 불가)와 `std::reduce`(C++17, 순서 자유·병렬 가능)는 인터페이스가 같지만 병렬화 가능성이 다르다.
- 실행 정책(`std::execution::par`)은 "허가"이지 "강제"가 아니다 — 이 환경에서는 `libtbb`가 없으면 조용히 순차로 대체됐고(실측: `reduce(par)` ≈ `reduce(순차)`), `libtbb-dev` 설치 후 `-ltbb`를 링크해야만 `reduce`는 약 2.8~3.2배, `sort`는 약 2.8배 실제로 빨라졌다. 네 환경에서 반드시 재확인해야 하는 항목이다.
- `std::remove`/`remove_if`는 컨테이너를 줄이지 않는다 — 반복자 범위만 다루는 알고리즘이라 컨테이너의 `size()`를 바꿀 권한이 없다(실측: 호출 직후에도 `size()`가 그대로 7). 실제로 줄이려면 `erase(new_end, end())`를 이어 불러야 한다.
- C++20의 `std::erase_if`는 이 두 단계를 컨테이너별 자유 함수 하나로 묶는다(실측: 한 번의 호출로 `size()`가 곧바로 4).
- 알고리즘이 컨테이너가 아니라 반복자 범위 위에서 동작하도록 설계됐기 때문에, 하나의 알고리즘 구현이 모든 컨테이너에 재사용된다 — 정확한 반복자 카테고리·무효화 규칙은 [5.4](#/iterators)에서 다룬다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일해서 확인하는 실습이다.

1. `std::remove_if`를 호출한 직후 컨테이너의 `size()`가 왜 그대로인지, 그 이유를 "알고리즘이 반복자 범위만 받는다"는 이 절 9번의 설계와 연결해서 설명하라.

2. 이 절 6번의 실측에서 `libtbb-dev`가 없을 때와 있을 때 `std::execution::par`를 붙인 코드의 컴파일·링크·실행 결과가 각각 어떻게 달랐는지 세 가지 경우(① 없음, ② 있지만 `-ltbb` 안 붙임, ③ 있고 `-ltbb` 붙임)로 나눠 정리하라.

3. (예측) `std::accumulate`로 문자열 벡터를 이어붙이는 코드(`std::accumulate(v.begin(), v.end(), std::string{})`)를 `std::reduce`로 그대로 바꾸면 안전한지 예측하라. 힌트: 문자열 이어붙이기(`+`)가 결합 법칙을 만족하는 연산인지부터 따져라.

4. (실습, 코드 작성형) `remove_only.cpp`를 그대로 타이핑해서 실행하고, `remove_if` 호출 직후 `v`를 순회하며 전체 원소를 출력해라. 성공 기준: 살아남은 값 뒤에 뒤섞인 옛 값(이 절 실측에서는 `5 -6 7`)이 그대로 남아 있는 것을 네 눈으로 확인한다.

5. (실습) `sort_compare.cpp`의 `N`을 200만에서 20만으로 낮춰 다시 실행하고, `std::sort`와 손 퀵정렬의 시간 배율이 이 절의 실측(약 14~17% 차이)과 비슷하게 재현되는지 확인해라. 성공 기준: 두 값이 크게 벌어지지 않는지, 벌어진다면 어느 쪽이 왜 그런지 네 나름의 가설을 한 줄로 적는다.
:::

::: answer 해설
1. `std::remove_if`는 `<algorithm>`에 속한 함수로 인자로 반복자 범위(`begin`, `end`)만 받고 컨테이너 객체 자체를 받지 않는다 — 그래서 이 함수 안에서는 애초에 "어느 컨테이너의 크기를 줄여야 하는지" 알 방법이 없다. 할 수 있는 일은 반복자로 가리켜지는 원소들 자체를 앞으로 밀어 재배치하고 새 논리적 끝을 반복자로 돌려주는 것뿐이다. 크기를 바꾸는 건 그 컨테이너의 멤버 함수(`erase`)만 할 수 있다.
2. ① `libtbb-dev`가 아예 없으면: 컴파일·링크 모두 에러 없이 성공하지만, `execution::par`를 붙인 호출이 순차 실행과 똑같은 시간이 나온다 — 조용히 순차로 대체됐다는 뜻이다. ② `libtbb-dev`는 설치했지만 `-ltbb`를 안 붙이면: 링크 단계에서 `tbb::detail::r1::...` 계열의 undefined reference 에러로 빌드 자체가 실패한다. ③ `libtbb-dev` 설치 후 `-ltbb`까지 링크하면: 실제로 여러 스레드로 나뉘어 실행되어 순차 대비 몇 배(이 절 실측: `reduce` 약 2.8~3.2배, `sort` 약 2.8배, 4코어 환경) 빨라진다.
3. 안전하지 않다. `std::reduce`는 원소를 어떤 순서로 묶어 계산해도 결과가 같은 연산(결합·교환 법칙)에서만 정확성을 보장한다. 문자열 이어붙이기는 교환 법칙은 깨지고("a"+"b" ≠ "b"+"a") 결합 법칙만 성립하는 연산이라, 병렬 정책 없이 순차로 돌리는 한 결과는 같겠지만 애초에 `reduce`가 상정하는 "순서 무관 병렬화"의 전제와 맞지 않는 연산이다 — 순서를 반드시 지켜야 하는 연산에는 `accumulate`를 쓰는 것이 정직한 선택이다.
4. `1 3 5 7`(살아남은 값들이 순서대로 앞에 채워진 것) 뒤에, `remove_if`가 밀어내며 남긴 옛 값의 잔재(이 절 실측 기준 `5 -6 7`)가 그대로 붙어 나온다 — 이 잔재는 `erase`를 부르기 전까지는 `size()` 안에 여전히 "유효한 원소"로 잡혀 있다는 뜻이다.
5. 도입정렬의 하이브리드 전략(재귀 깊이·구간 크기에 따라 알고리즘을 바꾸는 것)은 데이터 규모와 무관하게 항상 작동하므로, `std::sort`가 손 퀵정렬보다 앞서는 비율은 규모가 줄어도 비슷한 수준(10%대 초반~20%대)으로 재현되는 것이 정상이다. 크게 벗어난다면 이 절의 실측 환경(g++ 13.3, `-O2`, 4코어)과 다른 컴파일러 버전·최적화 레벨을 쓰고 있지 않은지부터 의심해라.
:::

이 절의 `sort_compare.cpp`, `find_demo.cpp`, `transform_demo.cpp`, `accumulate_reduce.cpp`, `remove_only.cpp`, `erase_if_demo.cpp`, `sort_par.cpp`를 전부 직접 타이핑해라. `accumulate_reduce.cpp`와 `sort_par.cpp`는 `libtbb-dev`가 설치돼 있는지부터(`dpkg -l | grep libtbb`) 확인하고, 설치돼 있다면 반드시 `-ltbb`를 붙여서 링크해라 — 안 붙이면 이 절 6번에서 본 것과 같은 undefined reference 에러를 그대로 겪을 것이다. 기준 명령: `g++ -std=c++20 -Wall -Wextra -O2 파일.cpp -o 이름 [-ltbb] && ./이름`.

**다음 절**: [5.6 람다와 클로저](#/lambdas) — 이 절 곳곳에서 술어로 넘긴 `[](const JointState& j) { ... }` 람다가 실제로는 컴파일러가 만들어 주는 평범한 클래스라는 것, 캡처(`[&]`, `[=]`)가 그 클래스의 멤버로 어떻게 번역되는지, 그리고 캡처가 만드는 함정을 다음 절에서 파헤친다.
