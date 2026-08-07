"""
Rental terms & conditions, kept in both languages so the invoice can render them
in whichever language is chosen at registration (independent of the UI language).
The Turkish text is the authoritative source supplied by the business; the
English is a faithful translation.
"""

RENTAL_TERMS = {
    "tr": {
        "title": "ARAÇ KİRALAMA ŞARTLARI VE HASAR SORUMLULUĞU",
        "rules": [
            "Araç, trafik kurallarına uygun şekilde kullanılmalıdır. Hız limitlerine uyulması zorunludur.",
            "Şirket kuralı gereği araçların maksimum kullanım hızı 120 km/h’dir. 120 km/h hız limitinin aşılması durumunda, aşırı hız kaynaklı motor, turbo, şanzıman veya mekanik arızalardan müşteri sorumludur. Araç GPS verileri ve hız kayıtları geçerli delil olarak kabul edilir.",
            "Araç içerisinde sigara içmek kesinlikle yasaktır. Sigara kokusu, yanık izi veya koltuk/döşeme zararlarında temizlik, tamir veya değişim ücreti müşteriye aittir.",
            "Koltuk, döşeme, plastik aksam, multimedya ekranı veya araç iç ekipmanlarında oluşan zararlar müşteri tarafından karşılanır.",
            "Lastik patlaması, jant eğilmesi, kaldırıma vurma, yanlış kullanım veya dikkatsizlik sonucu oluşan hasarlar müşteri sorumluluğundadır.",
            "Ön cam, far, ayna veya araç camlarında oluşan kırık ve çatlaklar kullanıcı hatası veya ihmal durumunda müşteri tarafından karşılanır.",
            "Yanlış yakıt kullanımı sonucu doğan tüm masraflar müşteriye aittir.",
            "Araç anahtarının kaybolması, kırılması veya zarar görmesi durumunda yeni anahtar, yazılım ve çekici masrafları müşteriye aittir.",
            "Trafik cezaları, otoban ücretleri, park cezaları ve geçiş ücretleri kiracıya aittir.",
            "Araç teslim edilirken video ve fotoğraf kaydı alınmaktadır. Araç teslim anındaki mevcut durum resmi kayıt olarak kabul edilir.",
            "Şirket, güvenlik ve filo yönetimi amacıyla araç takip (GPS) sistemi kullanmaktadır.",
            "Araç, teslim alındığı yakıt seviyesi ile iade edilmelidir.",
            "Geç iade: Araç, anlaşılan tarih ve saatte iade edilmelidir. Anlaşılan iade saatini aşan her başlayan gün, tam bir ek kiralama günü olarak ücretlendirilir; ayrıca geç iade cezası uygulanabilir.",
        ],
    },
    "en": {
        "title": "VEHICLE RENTAL TERMS & DAMAGE LIABILITY",
        "rules": [
            "The vehicle must be used in accordance with traffic rules. Compliance with speed limits is mandatory.",
            "By company policy the maximum operating speed of the vehicles is 120 km/h. If the 120 km/h limit is exceeded, the customer is liable for any engine, turbo, transmission or mechanical failure caused by excessive speed. The vehicle's GPS data and speed records are accepted as valid evidence.",
            "Smoking inside the vehicle is strictly prohibited. Cleaning, repair or replacement costs for cigarette odour, burn marks or seat/upholstery damage are charged to the customer.",
            "Damage to seats, upholstery, plastic parts, the multimedia screen or interior equipment is covered by the customer.",
            "Damage resulting from tyre blow-outs, bent rims, hitting a kerb, misuse or carelessness is the customer's responsibility.",
            "Cracks and chips on the windscreen, headlights, mirrors or windows are covered by the customer in the event of user error or negligence.",
            "All costs arising from using the wrong fuel are charged to the customer.",
            "If the vehicle key is lost, broken or damaged, the cost of a new key, software and towing is charged to the customer.",
            "Traffic fines, motorway tolls, parking fines and pass charges are payable by the renter.",
            "Video and photo records are taken at hand-over. The vehicle's condition at hand-over is accepted as the official record.",
            "The company uses a vehicle-tracking (GPS) system for security and fleet-management purposes.",
            "The vehicle must be returned with the same fuel level at which it was received.",
            "Late return: the vehicle must be returned by the agreed date and time. Each commenced day of delay beyond the agreed return time is billed as a full additional rental day, and a late-return penalty may also apply.",
        ],
    },
}


# Merge the auto-generated Albanian language module.
from config.lang_sq import TERMS as _SQ_TERMS   # noqa: E402
RENTAL_TERMS["sq"] = _SQ_TERMS


def rental_terms(lang: str) -> dict:
    return RENTAL_TERMS.get(lang, RENTAL_TERMS["en"])
