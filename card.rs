#[derive(Debug, Clone, PartialEq)]
pub enum Suit {
    Hearts,
    Diamonds,
    Clubs,
    Spades,
}

#[derive(Debug, Clone)]
pub struct Card {
    pub suit: Suit,
    pub value: u8, // 1 for Ace, 11 for Jack, etc.
}

impl Card {
    pub fn new(suit: Suit, value: u8) -> Self {
        Self { suit, value }
    }

    pub fn name(&self) -> String {
        let value_name = match self.value {
            1 => "Ace".to_string(),
            11 => "Jack".to_string(),
            12 => "Queen".to_string(),
            13 => "King".to_string(),
            _ => self.value.to_string(),
        };
        format!("{} of {:?}", value_name, self.suit)
    }
}
