import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Dimensions,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Animated,
} from 'react-native';

const { width, height } = Dimensions.get('window');

// Weather icons mapping
const weatherIcons = {
  '01d': '☀️', '01n': '🌙',
  '02d': '⛅', '02n': '☁️',
  '03d': '☁️', '03n': '☁️',
  '04d': '☁️', '04n': '☁️',
  '09d': '🌧️', '09n': '🌧️',
  '10d': '🌦️', '10n': '🌧️',
  '11d': '⛈️', '11n': '⛈️',
  '13d': '🌨️', '13n': '🌨️',
  '50d': '🌫️', '50n': '🌫️',
};

const WeatherApp = () => {
  const [currentWeather, setCurrentWeather] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [location, setLocation] = useState('Islamabad');
  const [searchText, setSearchText] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  
  const searchAnimation = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef(null);

  // You'll need to get a free API key from openweathermap.org
  const API_KEY = '';
  const BASE_URL = 'https://api.openweathermap.org/data/2.5';

  const fetchWeatherData = async (cityName = location) => {
    try {
      setLoading(true);
      
      // Fetch current weather
      const currentResponse = await fetch(
        `${BASE_URL}/weather?q=${cityName}&appid=${API_KEY}&units=metric`
      );
      const currentData = await currentResponse.json();
      
      if (currentResponse.ok) {
        setCurrentWeather(currentData);
        setLocation(currentData.name); // Update location with actual city name from API
        
        // Fetch 5-day forecast
        const forecastResponse = await fetch(
          `${BASE_URL}/forecast?q=${cityName}&appid=${API_KEY}&units=metric`
        );
        const forecastData = await forecastResponse.json();
        
        if (forecastResponse.ok) {
          // Process forecast data to get daily forecasts
          const dailyForecasts = processForecastData(forecastData.list);
          setForecast(dailyForecasts);
        }
      } else {
        Alert.alert('Error', currentData.message || 'City not found. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setIsSearching(false);
    }
  };

  const processForecastData = (forecastList) => {
    const dailyData = {};
    
    forecastList.forEach(item => {
      const date = new Date(item.dt * 1000).toDateString();
      if (!dailyData[date]) {
        dailyData[date] = {
          date: date,
          temp_max: item.main.temp_max,
          temp_min: item.main.temp_min,
          description: item.weather[0].description,
          icon: item.weather[0].icon,
        };
      } else {
        dailyData[date].temp_max = Math.max(dailyData[date].temp_max, item.main.temp_max);
        dailyData[date].temp_min = Math.min(dailyData[date].temp_min, item.main.temp_min);
      }
    });
    
    return Object.values(dailyData).slice(0, 5);
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchWeatherData();
  };

  const handleSearch = () => {
    if (searchText.trim()) {
      setIsSearching(true);
      Keyboard.dismiss();
      fetchWeatherData(searchText.trim());
      setSearchText('');
    }
  };

  const handleSearchSubmit = () => {
    handleSearch();
  };

  const toggleSearch = () => {
    if (isSearchExpanded) {
      // Collapse search
      Animated.timing(searchAnimation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start(() => {
        setIsSearchExpanded(false);
      });
      Keyboard.dismiss();
    } else {
      // Expand search
      setIsSearchExpanded(true);
      Animated.timing(searchAnimation, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      });
    }
  };

  const handleSearchBlur = () => {
    if (!searchText.trim()) {
      toggleSearch();
    }
  };

  const getBackgroundStyle = () => {
    if (!currentWeather) return { backgroundColor: '#74b9ff' };
    
    const hour = new Date().getHours();
    
    if (hour >= 6 && hour < 12) {
      // Morning
      return { backgroundColor: '#74b9ff' };
    } else if (hour >= 12 && hour < 18) {
      // Afternoon
      return { backgroundColor: '#fdcb6e' };
    } else if (hour >= 18 && hour < 21) {
      // Evening
      return { backgroundColor: '#fd79a8' };
    } else {
      // Night
      return { backgroundColor: '#2d3436' };
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  };

  useEffect(() => {
    fetchWeatherData();
  }, []);

  if (loading && !currentWeather) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: '#74b9ff' }]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loadingText}>Loading weather data...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, getBackgroundStyle()]}>
      <StatusBar barStyle="light-content" />
      
      {/* Animated Search Bar */}
      <Animated.View 
        style={[
          styles.searchContainer,
          {
            width: searchAnimation.interpolate({
              inputRange: [0, 1],
              outputRange: [50, width - 40],
            }),
            opacity: searchAnimation.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [1, 0.8, 1],
            }),
          }
        ]}
      >
        {isSearchExpanded && (
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search for a city..."
            placeholderTextColor="rgba(255, 255, 255, 0.7)"
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={handleSearchSubmit}
            onBlur={handleSearchBlur}
            returnKeyType="search"
            autoCapitalize="words"
            autoCorrect={false}
          />
        )}
        <TouchableOpacity 
          style={styles.searchButton} 
          onPress={isSearchExpanded ? handleSearch : toggleSearch}
          disabled={isSearchExpanded && (!searchText.trim() || isSearching)}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>🔍</Text>
          )}
        </TouchableOpacity>
      </Animated.View>
      
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.locationText}>{currentWeather?.name}</Text>
          <Text style={styles.dateText}>{new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}</Text>
        </View>

        {/* Current Weather */}
        <View style={styles.currentWeatherContainer}>
          <Text style={styles.weatherIcon}>
            {weatherIcons[currentWeather?.weather[0].icon] || '☀️'}
          </Text>
          <Text style={styles.temperature}>
            {Math.round(currentWeather?.main.temp || 0)}°
          </Text>
          <Text style={styles.description}>
            {currentWeather?.weather[0].description || 'Clear sky'}
          </Text>
          <Text style={styles.feelsLike}>
            Feels like {Math.round(currentWeather?.main.feels_like || 0)}°
          </Text>
        </View>

        {/* Weather Details */}
        <View style={styles.detailsContainer}>
          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Humidity</Text>
              <Text style={styles.detailValue}>{currentWeather?.main.humidity || 0}%</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Wind</Text>
              <Text style={styles.detailValue}>{Math.round(currentWeather?.wind.speed || 0)} m/s</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Pressure</Text>
              <Text style={styles.detailValue}>{currentWeather?.main.pressure || 0} hPa</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Visibility</Text>
              <Text style={styles.detailValue}>{Math.round((currentWeather?.visibility || 0) / 1000)} km</Text>
            </View>
          </View>
        </View>

        {/* 5-Day Forecast */}
        <View style={styles.forecastContainer}>
          <Text style={styles.forecastTitle}>5-Day Forecast</Text>
          {forecast.map((day, index) => (
            <View key={index} style={styles.forecastItem}>
              <Text style={styles.forecastDay}>{formatDate(day.date)}</Text>
              <View style={styles.forecastMiddle}>
                <Text style={styles.forecastIcon}>
                  {weatherIcons[day.icon] || '☀️'}
                </Text>
                <Text style={styles.forecastDescription}>{day.description}</Text>
              </View>
              <View style={styles.forecastTemps}>
                <Text style={styles.forecastTempHigh}>{Math.round(day.temp_max)}°</Text>
                <Text style={styles.forecastTempLow}>{Math.round(day.temp_min)}°</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 10,
    fontWeight: '300',
  },
  scrollContent: {
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  locationText: {
    fontSize: 28,
    fontWeight: '300',
    color: '#fff',
    marginBottom: 5,
  },
  dateText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '300',
  },
  currentWeatherContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  weatherIcon: {
    fontSize: 80,
    marginBottom: 10,
  },
  temperature: {
    fontSize: 72,
    fontWeight: '100',
    color: '#fff',
    marginBottom: 5,
  },
  description: {
    fontSize: 20,
    color: 'rgba(255, 255, 255, 0.9)',
    textTransform: 'capitalize',
    marginBottom: 5,
    fontWeight: '300',
  },
  feelsLike: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '300',
  },
  detailsContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 30,
    backdropFilter: 'blur(10px)',
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  detailItem: {
    width: '48%',
    alignItems: 'center',
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 5,
    fontWeight: '300',
  },
  detailValue: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '400',
  },
  forecastContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  forecastTitle: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '400',
    marginBottom: 15,
  },
  forecastItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  forecastDay: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '300',
    width: 80,
  },
  forecastMiddle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  forecastIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  forecastDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'capitalize',
    flex: 1,
    fontWeight: '300',
  },
  forecastTemps: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  forecastTempHigh: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '400',
    marginRight: 5,
  },
  forecastTempLow: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '300',
  },
  refreshButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 30,
    alignSelf: 'center',
    marginTop: 10,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '400',
  },
  searchContainer: {
    position: 'absolute',
    top: 50,
    right: 20,
    height: 50,
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 25,
    alignItems: 'center',
    paddingHorizontal: 5,
    zIndex: 1000,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 15,
    fontWeight: '300',
    height: 40,
  },
  searchButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    fontSize: 18,
  },
});

export default WeatherApp;
